import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { TeamsActivityInbox } from "./activity-inbox.ts";
import type { TeamsConnectorActivity } from "./connector-auth.ts";
import { createTeamsGatewayClock, createTeamsGatewayProofVerifier } from "./gateway-proof.ts";
import { createTeamsInbound } from "./inbound.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const seconds = 1_700_000_000;
const key = randomBytes(32);
const activity: TeamsConnectorActivity = {
  type: "message", id: "activity-1", channelId: "msteams", serviceUrl: "https://service.example/",
  channelData: { tenant: { id: tenantId } }, from: { id: "sender", aadObjectId: objectId },
  conversation: { id: "conversation-1", conversationType: "personal" }, recipient: { id: "bot" }, text: "Hello",
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const body = bytes(activity);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const verify = createTeamsGatewayProofVerifier({ appId, key, clock: () => seconds * 1000 });

async function proof(claims: Record<string, unknown> = {}, signingKey = key): Promise<string> {
  return new SignJWT({ purpose: "sender-identity", gateway_epoch: verify.epoch, tenant_id: tenantId, object_id: objectId,
    body_sha256: hash(body), jti: randomUUID(), ...claims })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("openbot-teams-gateway").setAudience(`openbot:teams:${appId}`)
    .setIssuedAt(seconds - 1).setNotBefore(seconds - 1).setExpirationTime(seconds + 30).sign(signingKey);
}

describe("Teams gateway identity proof", () => {
  it("accepts only a short-lived proof for the exact activity and user", async () => {
    const token = await proof();
    expect(await verify(activity, body, token)).toEqual({ appId, tenantId, objectId });
    expect(await verify(activity, bytes({ ...activity, text: "Changed" }), token)).toBeNull();
    expect(await verify({ ...activity, from: { id: "sender", aadObjectId: tenantId } }, body, token)).toBeNull();
    expect(await verify(activity, body)).toBeNull();
    expect(await verify(activity, body, await proof({}, randomBytes(32)))).toBeNull();
    expect(await verify(activity, body, await proof({ tenant_id: objectId }))).toBeNull();
  });

  it("rejects expired, overlong and wrong-audience proofs", async () => {
    const make = (audience: string, exp: number, issuer = "openbot-teams-gateway") => new SignJWT({ gateway_epoch: verify.epoch, tenant_id: tenantId, object_id: objectId, body_sha256: hash(body) })
      .setProtectedHeader({ alg: "HS256" }).setIssuer(issuer).setAudience(audience)
      .setIssuedAt(seconds - 10).setNotBefore(seconds - 10).setExpirationTime(exp).sign(key);
    expect(await verify(activity, body, await make(`openbot:teams:${appId}`, seconds - 1))).toBeNull();
    expect(await verify(activity, body, await make(`openbot:teams:${appId}`, seconds + 100))).toBeNull();
    expect(await verify(activity, body, await make("other-app", seconds + 10))).toBeNull();
    expect(await verify(activity, body, await make(`openbot:teams:${appId}`, seconds + 10, "other-gateway"))).toBeNull();
    expect(() => createTeamsGatewayProofVerifier({ appId, key: new Uint8Array(31) })).toThrow();
  });

  it("does not revive an expired proof after a rollback observed by another verifier", async () => {
    let wall = seconds * 1000;
    let tick = 0;
    const clock = createTeamsGatewayClock(() => wall, () => tick);
    const first = createTeamsGatewayProofVerifier({ appId, key, clock });
    const second = createTeamsGatewayProofVerifier({ appId, key, clock });
    const token = await proof();
    expect(await first(activity, body, token)).not.toBeNull();
    wall += 31_000;
    tick += 31_000;
    expect(await first(activity, body, token)).toBeNull();
    wall = seconds * 1000 + 10_000;
    tick += 1_000;
    expect(await second(activity, body, token)).toBeNull();
  });

  it("rejects proofs from a previous process epoch", async () => {
    const token = await proof();
    vi.resetModules();
    const fresh = await import("./gateway-proof.ts");
    const afterRestart = fresh.createTeamsGatewayProofVerifier({ appId, key, clock: () => seconds * 1000 });
    expect(afterRestart.epoch).not.toBe(verify.epoch);
    expect(await afterRestart(activity, body, token)).toBeNull();
  });

  it("rejects a proof signed for another live process", async () => {
    const token = await proof();
    const source = `
      import { readFileSync } from "node:fs";
      import { createTeamsGatewayProofVerifier } from "./server/teams/gateway-proof.ts";
      const data = JSON.parse(readFileSync(0, "utf8"));
      const verify = createTeamsGatewayProofVerifier({ appId: data.appId, key: Buffer.from(data.key, "base64"), clock: () => data.now });
      const result = await verify(data.activity, Buffer.from(data.body, "base64"), data.proof);
      process.stdout.write(result === null ? "rejected" : "accepted");
    `;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
      input: JSON.stringify({ appId, key: key.toString("base64"), now: seconds * 1000, activity, body: Buffer.from(body).toString("base64"), proof: token }),
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("rejected");
  });

  it("does not claim or send a changed activity through the inbound coordinator", async () => {
    const inbox = new TeamsActivityInbox(":memory:");
    const send = vi.fn(async () => "accepted" as const);
    try {
      const receive = createTeamsInbound({
        appId, verifyConnector: async (_header, input) => input as TeamsConnectorActivity, verifySender: verify,
        resolveMember: () => "member", resolveBot: () => "bot", authorize: async () => true,
        claim: (key, raw) => inbox.claim(key, raw), complete: (id, lease) => inbox.complete(id, lease), send,
      });
      const token = await proof();
      expect(await receive("connector", bytes({ ...activity, text: "Changed" }), token)).toBe("unauthorized");
      expect(send).not.toHaveBeenCalled();
      expect(await receive("connector", body, token)).toBe("accepted");
      expect(await receive("connector", body, token)).toBe("duplicate");
      expect(send).toHaveBeenCalledOnce();
    } finally { inbox.close(); }
  });
});
