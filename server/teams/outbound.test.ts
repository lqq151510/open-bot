import { describe, expect, it, vi } from "vitest";
import { createTeamsOutbound, type TeamsOutboundDependencies, type TeamsReplyTarget } from "./outbound.ts";

function setup() {
  const target: TeamsReplyTarget = {
    appId: "app", tenantId: "tenant", botId: "bot", memberId: "member",
    conversationId: "19:team/room@thread", activityId: "activity:123", serviceUrl: "https://teams.example/region/",
  };
  const calls = {
    authenticateCaller: vi.fn(async (_caller: string) => ({ appId: "app", tenantId: "tenant", botId: "bot", memberId: "member" })),
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

  it("does not retry after an ambiguous network error or server failure", async () => {
    const { calls, send } = setup();
    calls.fetch.mockRejectedValueOnce(new Error("private fixture-token"));
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unknown" });
    expect(calls.fetch).toHaveBeenCalledTimes(1);
    calls.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unknown" });
    expect(calls.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed targets and oversized messages without sending", async () => {
    const { target, calls, send } = setup();
    expect(await send("session", "ref", "中".repeat(10_000))).toEqual({ state: "invalid" });
    target.conversationId = "..";
    expect(await send("session", "ref", "Hello")).toEqual({ state: "unauthorized" });
    expect(calls.fetch).not.toHaveBeenCalled();
  });
});
