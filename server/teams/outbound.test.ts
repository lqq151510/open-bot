import { describe, expect, it, vi } from "vitest";
import { createTeamsOutbound, type TeamsOutboundDependencies, type TeamsReplyActor, type TeamsReplyTarget } from "./outbound.ts";

function setup() {
  const target: TeamsReplyTarget = {
    appId: "app", tenantId: "tenant", botId: "bot", botGeneration: "bot-gen-1", memberId: "member", memberGeneration: "member-gen-1",
    conversationId: "19:team/room@thread", activityId: "activity:123", serviceUrl: "https://teams.example/region/",
  };
  const calls = {
    authenticateCaller: vi.fn(async (_caller: string) => ({ appId: "app", tenantId: "tenant", botId: "bot", botGeneration: "bot-gen-1", memberId: "member", memberGeneration: "member-gen-1" }) as TeamsReplyActor | null),
    resolveTarget: vi.fn(async () => target as TeamsReplyTarget | null),
    authorize: vi.fn(async () => true),
    accessToken: vi.fn(async () => "fixture-token"),
    fetch: vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(null, { status: 200 })),
  };
  const deps: TeamsOutboundDependencies<string> = { appId: "app", allowedServiceOrigins: ["https://teams.example"], ...calls };
  return { target, calls, send: createTeamsOutbound(deps) };
}

describe("Teams replies", () => {
  it("uses the authorized stored reference and never follows redirects", async () => {
    const { calls, send } = setup();
    expect(await send("session", "ref", "Hello")).toEqual({ state: "sent" });
    const [url, init] = calls.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://teams.example/region/v3/conversations/19%3Ateam%2Froom%40thread/activities/activity%3A123");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer fixture-token", "content-type": "application/json" } });
    expect(JSON.parse(String(init!.body))).toEqual({ type: "message", text: "Hello" });
  });

  it("does not obtain credentials or send for a revoked member or untrusted service", async () => {
    const { target, calls, send } = setup();
    calls.authorize.mockResolvedValueOnce(false);
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    target.serviceUrl = "https://attacker.example/";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "invalid" });
    expect(calls.accessToken).not.toHaveBeenCalled();
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("rejects guessed references belonging to another member or tenant", async () => {
    const { target, calls, send } = setup();
    target.memberId = "other";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    target.memberId = "member";
    target.tenantId = "other-tenant";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.accessToken).not.toHaveBeenCalled();
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it.each(["botGeneration", "memberGeneration"] as const)("rejects an old reference after %s changes", async (generation) => {
    const { calls, send } = setup();
    calls.authenticateCaller.mockResolvedValueOnce({ appId: "app", tenantId: "tenant", botId: "bot", botGeneration: "bot-gen-1", memberId: "member", memberGeneration: "member-gen-1", [generation]: "new-generation" });
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.accessToken).not.toHaveBeenCalled();
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("refuses a missing generation instead of accepting a legacy reference", async () => {
    const { calls, send } = setup();
    calls.authenticateCaller.mockResolvedValueOnce({ appId: "app", tenantId: "tenant", botId: "bot", memberId: "member" } as TeamsReplyActor);
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("checks the session, target and permission again after obtaining a token", async () => {
    const { target, calls, send } = setup();
    calls.accessToken.mockImplementationOnce(async () => { target.memberId = "other"; return "fixture-token"; });
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    target.memberId = "member";
    calls.authenticateCaller.mockResolvedValueOnce({ appId: "app", tenantId: "tenant", botId: "bot", botGeneration: "bot-gen-1", memberId: "member", memberGeneration: "member-gen-1" }).mockResolvedValueOnce(null);
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    calls.authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("rejects a Bot replacement between authorization and delivery", async () => {
    const { target, calls, send } = setup();
    calls.accessToken.mockImplementationOnce(async () => { target.botGeneration = "bot-gen-2"; return "fixture-token"; });
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("does not retry after an ambiguous network error or server failure", async () => {
    const { calls, send } = setup();
    calls.fetch.mockRejectedValueOnce(new Error("private fixture-token"));
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unknown" });
    expect(calls.fetch).toHaveBeenCalledTimes(1);
    calls.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unknown" });
    expect(calls.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["conversationId", "activityId"] as const)("rejects an unpaired surrogate in %s without sending", async (field) => {
    const { target, calls, send } = setup();
    for (const malformed of ["\uD800", "\uDC00"]) {
      target[field] = malformed;
      await expect(send("session", "ref", "Hello")).resolves.toEqual({ state: "unauthorized" });
    }
    expect(calls.accessToken).not.toHaveBeenCalled();
    expect(calls.fetch).not.toHaveBeenCalled();
  });

  it("accepts a valid surrogate pair in the activity ID", async () => {
    const { target, calls, send } = setup();
    target.activityId = "activity-😀";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "sent" });
    expect(String(calls.fetch.mock.calls[0]![0])).toContain("activity-%F0%9F%98%80");
  });

  it("rejects malformed targets and oversized messages without sending", async () => {
    const { target, calls, send } = setup();
    expect(await send("session", "ref", "中".repeat(10_000))).toEqual({ state: "invalid" });
    target.conversationId = "..";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.fetch).not.toHaveBeenCalled();
  });
});
