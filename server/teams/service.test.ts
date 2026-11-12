import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamsConnectorActivity } from "./connector-auth.ts";
import { createTeamsService, type TeamsHost } from "./service.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

function activity(text: string, id = "a1", conversationType = "personal") {
  return { type: "message", id, channelId: "msteams", serviceUrl: "https://example.test/",
    channelData: { tenant: { id: tenantId } }, from: { id: "sender", aadObjectId: objectId },
    conversation: { id: "conversation", conversationType }, recipient: { id: "bot" }, text };
}

describe("Teams service", () => {
  it("requires verified sender proof and a private account link before accepting and deduplicating messages", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "openbot-teams-")); dirs.push(dataDir);
    const gatewayKey = randomBytes(32);
    let memberActive = true;
    const host: TeamsHost = {
      isCurrentMember: (member) => memberActive && member === "member_1234567890",
      resolveBot: ({ recipientId }) => recipientId === "bot" ? "local-bot" : null,
      authorize: async ({ memberId }) => memberActive && memberId === "member_1234567890",
      send: vi.fn(async () => "accepted" as const),
    };
    const verifyConnector = vi.fn(async (authorization: string | undefined, body: unknown) => {
      if (authorization !== "connector") throw new Error("invalid connector");
      return body as TeamsConnectorActivity;
    });
    const config = { appId, tenantId, gatewayKey, dataDir };
    let service = createTeamsService(config, host, { verifyConnector });
    const makeRequest = async (value: ReturnType<typeof activity>, epoch = service.gatewayEpoch) => {
      const raw = Buffer.from(JSON.stringify(value));
      const now = Math.floor(Date.now() / 1000);
      const proof = await new SignJWT({ purpose: "sender-identity", gateway_epoch: epoch, tenant_id: tenantId, object_id: objectId,
        body_sha256: createHash("sha256").update(raw).digest("hex"), jti: randomUUID() })
        .setProtectedHeader({ alg: "HS256" }).setIssuer("openbot-teams-gateway")
        .setAudience(`openbot:teams:${appId}`).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 30).sign(gatewayKey);
      return { raw, proof };
    };
    try {
      const unlinked = await makeRequest(activity("hello"));
      expect(await service.receive("connector", unlinked.raw, unlinked.proof)).toBe("unauthorized");
      expect(await service.receive("bad", unlinked.raw, unlinked.proof)).toBe("unauthorized");
      expect(await service.receive("connector", unlinked.raw)).toBe("unauthorized");
      const challenge = service.issueLink("member_1234567890");
      const groupLink = await makeRequest(activity(`/openbot-link ${challenge.secret}`, "link", "groupChat"));
      expect(await service.receive("connector", groupLink.raw, groupLink.proof)).toBe("unauthorized");
      const privateLink = await makeRequest(activity(`/openbot-link ${challenge.secret}`, "link"));
      expect(await service.receive("connector", privateLink.raw, privateLink.proof)).toBe("linked");
      expect(await service.receive("connector", privateLink.raw, privateLink.proof)).toBe("unauthorized");
      const wrongBody = Buffer.from(JSON.stringify(activity("different")));
      expect(await service.receive("connector", wrongBody, unlinked.proof)).toBe("unauthorized");
      expect(await service.receive("connector", unlinked.raw, unlinked.proof)).toBe("accepted");
      expect(await service.receive("connector", unlinked.raw, unlinked.proof)).toBe("duplicate");
      service.close();
      service = createTeamsService(config, host, { verifyConnector });
      expect(await service.receive("connector", unlinked.raw, unlinked.proof)).toBe("duplicate");
      memberActive = false;
      const revoked = await makeRequest(activity("after removal", "a2"));
      expect(await service.receive("connector", revoked.raw, revoked.proof)).toBe("unauthorized");
      expect(host.send).toHaveBeenCalledTimes(1);
    } finally { service.close(); }
  });
});
