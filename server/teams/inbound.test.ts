import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamsActivityInbox } from "./activity-inbox.ts";
import { createTeamsInbound, type TeamsInboundDependencies } from "./inbound.ts";
import type { TeamsConnectorActivity } from "./connector-auth.ts";

const appId = "11111111-1111-4111-8111-111111111111", tenantId = "22222222-2222-4222-8222-222222222222", objectId = "person";
const activity = (extra: Record<string, unknown> = {}) => ({
  type: "message", id: "a1", channelId: "msteams", serviceUrl: "https://example.test/",
  channelData: { tenant: { id: tenantId } }, from: { id: "sender", aadObjectId: objectId },
  conversation: { id: "conv", conversationType: "personal" }, recipient: { id: "bot" }, text: "hello", ...extra,
});
const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const inboxes: TeamsActivityInbox[] = [];
afterEach(() => { for (const inbox of inboxes.splice(0)) inbox.close(); });

function setup() {
  let now = 1000;
  const inbox = new TeamsActivityInbox(":memory:", () => now);
  inboxes.push(inbox);
  const accepted = new Set<string>();
  const deps: TeamsInboundDependencies = {
    appId,
    verifyConnector: vi.fn(async (_authorization, value) => value as TeamsConnectorActivity),
    verifySender: vi.fn(async () => ({ appId, tenantId, objectId })),
    resolveMember: vi.fn(() => "member"),
    resolveBot: vi.fn(() => "local-bot"),
    authorize: vi.fn(async () => true),
    claim: (key, raw) => inbox.claim(key, raw, 1000),
    complete: (id, lease) => inbox.complete(id, lease),
    send: vi.fn(async ({ sendId }) => { accepted.add(sendId); return "accepted" as const; }),
  };
  return { deps, accepted, advance: () => { now += 1001; }, receive: createTeamsInbound(deps) };
}

describe("Teams inbound coordination", () => {
  it("requires independently verified sender identity and current bot access before claiming", async () => {
    const h = setup();
    vi.mocked(h.deps.verifySender).mockResolvedValueOnce({ appId, tenantId, objectId: "different" });
    expect(await h.receive("Bearer x", body(activity()))).toBe("unauthorized");
    expect(h.deps.send).not.toHaveBeenCalled();
    vi.mocked(h.deps.authorize).mockResolvedValueOnce(false);
    expect(await h.receive("Bearer x", body(activity()))).toBe("unauthorized");
    expect(await h.receive("Bearer x", body(activity()))).toBe("accepted");
  });

  it("requires a mention of this bot in group and channel messages", async () => {
    const h = setup();
    const group = { conversation: { id: "group", conversationType: "channel" } };
    expect(await h.receive("Bearer x", body(activity(group)))).toBe("ignored");
    expect(await h.receive("Bearer x", body(activity({ ...group, entities: [{ type: "mention", mentioned: { id: "other" } }] })))).toBe("ignored");
    expect(await h.receive("Bearer x", body(activity({ ...group, entities: [{ type: "mention", mentioned: { id: "bot" } }] })))).toBe("accepted");
  });

  it("rechecks access after claiming, before sending", async () => {
    const h = setup();
    vi.mocked(h.deps.authorize).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await h.receive("Bearer x", body(activity()))).toBe("unauthorized");
    expect(h.deps.send).not.toHaveBeenCalled();
    h.advance();
    vi.mocked(h.deps.resolveBot).mockReturnValueOnce("local-bot").mockReturnValueOnce(null);
    expect(await h.receive("Bearer x", body(activity()))).toBe("unauthorized");
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it("fails closed when the durable receiver detects revocation after the pre-check", async () => {
    const h = setup();
    const complete = vi.spyOn(h.deps, "complete");
    let membershipActive = true;
    vi.mocked(h.deps.authorize).mockImplementation(async () => membershipActive);
    vi.mocked(h.deps.send).mockImplementationOnce(async ({ identity, recipientId, memberId, botId }) => {
      expect({ identity, recipientId, memberId, botId }).toEqual({
        identity: { appId, tenantId, objectId }, recipientId: "bot", memberId: "member", botId: "local-bot",
      });
      membershipActive = false;
      return membershipActive ? "accepted" : "unauthorized";
    });
    expect(await h.receive("Bearer x", body(activity()))).toBe("unauthorized");
    expect(h.accepted.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    membershipActive = true;
    h.advance();
    expect(await h.receive("Bearer x", body(activity()))).toBe("accepted");
    expect(h.accepted.size).toBe(1);
  });

  it("reuses a durable send ID after a crash and rejects altered retries", async () => {
    const h = setup();
    vi.mocked(h.deps.send).mockImplementationOnce(async ({ sendId }) => { h.accepted.add(sendId); throw new Error("after durable accept"); });
    await expect(h.receive("Bearer x", body(activity()))).rejects.toThrow("after durable accept");
    expect(await h.receive("Bearer x", body(activity({ text: "altered" })))).toBe("conflict");
    h.advance();
    expect(await h.receive("Bearer x", body(activity()))).toBe("accepted");
    expect(h.accepted.size).toBe(1);
    expect(await h.receive("Bearer x", body(activity()))).toBe("duplicate");
  });
});
