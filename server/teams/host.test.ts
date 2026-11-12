import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import type { TeamsConnectorActivity } from "./connector-auth.ts";
import { createTeamsHost, type TeamsRuntimeDependencies } from "./host.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const memberId = "member_1234567890";

describe("Teams host integration", () => {
  it("links, receives, completes and replies once; revocation and uncertain delivery do not resend", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "openbot-teams-host-"));
    const gatewayKey = randomBytes(32);
    let current = true, failDelivery = false;
    const settlements: Array<(result: { ok: boolean; text: string }) => void> = [];
    const accepted = new Set<string>();
    const deps: TeamsRuntimeDependencies = {
      personFor: () => current ? { email: "person@example.test", role: "member", admin: false } : null,
      botGeneration: () => "bot-generation",
      canUse: () => current,
      createPrivateThread: () => "private-thread",
      isPrivateThread: (thread) => thread === "private-thread",
      accept: vi.fn(async (input) => {
        if (!input.guard()) return "unauthorized";
        if (!accepted.has(input.sendId)) { accepted.add(input.sendId); settlements.push(input.onSettled); }
        return "accepted";
      }),
    };
    const delivered: string[] = [];
    const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://login.microsoftonline.com/")) return new Response('{"access_token":"token","expires_in":3600}');
      delivered.push(String(init?.body));
      return new Response(null, { status: failDelivery ? 503 : 200 });
    });
    const verifyConnector = async (authorization: string | undefined, body: unknown) => {
      if (authorization !== "connector") throw new Error("invalid connector");
      return body as TeamsConnectorActivity;
    };
    const config = { appId, tenantId, gatewayKey, clientSecret: "fake-secret", allowedServiceOrigins: ["https://teams.example.test"],
      botId: "bot", recipientId: "recipient", dataDir };
    const host = createTeamsHost(config, deps, { verifyConnector, fetch: fetchFake as typeof fetch });
    const request = async (text: string, id: string) => {
      const body = { type: "message", id, channelId: "msteams", serviceUrl: "https://teams.example.test/",
        channelData: { tenant: { id: tenantId } }, from: { id: "sender", aadObjectId: objectId },
        conversation: { id: "conversation", conversationType: "personal" }, recipient: { id: "recipient" }, text };
      const raw = Buffer.from(JSON.stringify(body)), now = Math.floor(Date.now() / 1000);
      const proof = await new SignJWT({ purpose: "sender-identity", gateway_epoch: host.service.gatewayEpoch, tenant_id: tenantId, object_id: objectId,
        body_sha256: createHash("sha256").update(raw).digest("hex"), jti: randomUUID() }).setProtectedHeader({ alg: "HS256" })
        .setIssuer("openbot-teams-gateway").setAudience(`openbot:teams:${appId}`).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 30).sign(gatewayKey);
      return { raw, proof };
    };
    try {
      const link = host.service.issueLink(memberId);
      const linkRequest = await request(`/openbot-link ${link.secret}`, "link1");
      expect(await host.service.receive("connector", linkRequest.raw, linkRequest.proof)).toBe("linked");
      const first = await request("hello", "message1");
      expect(await host.service.receive("connector", first.raw, first.proof)).toBe("accepted");
      expect(await host.service.receive("connector", first.raw, first.proof)).toBe("duplicate");
      settlements[0]!({ ok: true, text: "hello back" });
      await vi.waitFor(() => expect(delivered).toHaveLength(1));
      expect(JSON.parse(delivered[0]!)).toMatchObject({ type: "message", text: "hello back" });
      settlements[0]!({ ok: true, text: "hello back" });
      expect(delivered).toHaveLength(1);

      const second = await request("before unlink", "message2");
      expect(await host.service.receive("connector", second.raw, second.proof)).toBe("accepted");
      host.service.revokeLink(memberId);
      const relink = host.service.issueLink(memberId);
      const relinkRequest = await request(`/openbot-link ${relink.secret}`, "link2");
      expect(await host.service.receive("connector", relinkRequest.raw, relinkRequest.proof)).toBe("linked");
      settlements[1]!({ ok: true, text: "must not leave" });
      await vi.waitFor(() => expect(fetchFake).toHaveBeenCalledTimes(2));
      expect(delivered).toHaveLength(1);

      const third = await request("network failure", "message3");
      expect(await host.service.receive("connector", third.raw, third.proof)).toBe("accepted");
      failDelivery = true;
      settlements[2]!({ ok: true, text: "unknown delivery" });
      await vi.waitFor(() => expect(delivered).toHaveLength(2));
      settlements[2]!({ ok: true, text: "unknown delivery" });
      expect(delivered).toHaveLength(2);
      current = false;
      const revoked = await request("removed", "message4");
      expect(await host.service.receive("connector", revoked.raw, revoked.proof)).toBe("unauthorized");
    } finally { host.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
});
