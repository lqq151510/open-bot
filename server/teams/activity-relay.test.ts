import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTeamsActivityRelay, teamsIdentityMatches } from "./activity-relay.ts";
import { createTeamsGatewayProofVerifier, createTeamsGatewayRelayVerifier } from "./gateway-proof.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const key = randomBytes(32);
const epoch = "fixture-epoch-123";
const activity = {
  type: "message",
  id: "activity-1",
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/teams",
  channelData: { tenant: { id: tenantId }, fixture: "kept" },
  from: { id: "msteams-user", aadObjectId: objectId },
  conversation: { id: "personal-chat", conversationType: "personal" },
  recipient: { id: "bot-recipient" },
  text: "hello OpenBot",
  extensions: [{ name: "arbitrary activity field" }],
};

describe("Teams trusted identity relay", () => {
  it("checks the signed-in Graph user and forwards a body-bound proof", async () => {
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const relay = createTeamsActivityRelay({ appId, tenantId, recipientId: "bot-recipient", gatewayKey: key,
      openbotUrl: new URL("https://openbot.example.test") }, {
      fetch: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        const body = typeof init?.body === "string" ? init.body : init?.body instanceof Uint8Array ? Buffer.from(init.body).toString("utf8") : "";
        requests.push({ url, headers, body });
        if (url.endsWith("/gateway-challenge")) return Response.json({ epoch });
        return Response.json({ result: "accepted" });
      },
      clock: () => 1_800_000_000_000,
    });

    expect(await relay(activity, objectId)).toEqual({ status: 200, result: "accepted" });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.get("authorization")).toBe(`TeamsGatewayKey ${key.toString("base64url")}`);
    expect(requests[1]!.headers.get("authorization")).toMatch(/^TeamsGateway /);
    expect(requests[1]!.headers.get("x-openbot-teams-proof")).toBeTruthy();
    expect(JSON.parse(requests[1]!.body)).toEqual(activity);

    const parsed = JSON.parse(requests[1]!.body) as typeof activity;
    const authenticated = await createTeamsGatewayRelayVerifier({ appId, tenantId, key, epoch,
      clock: () => 1_800_000_000_000 })(requests[1]!.headers.get("authorization")!, parsed);
    const identity = await createTeamsGatewayProofVerifier({ appId, key, epoch,
      clock: () => 1_800_000_000_000 })(authenticated, Buffer.from(requests[1]!.body), requests[1]!.headers.get("x-openbot-teams-proof")!);
    expect(identity).toEqual({ appId, tenantId, objectId });
  });

  it("refuses a different Microsoft user before contacting OpenBot", async () => {
    let calls = 0;
    const relay = createTeamsActivityRelay({ appId, tenantId, recipientId: "bot-recipient", gatewayKey: key,
      openbotUrl: new URL("https://openbot.example.test") }, { fetch: async () => { calls++; return Response.json({ epoch }); } });
    await expect(relay(activity, "44444444-4444-4444-8444-444444444444")).rejects.toThrow("does not match");
    expect(calls).toBe(0);
  });

  it("treats deduplicated activities as handled and maps link authorization failures", async () => {
    let result: Response = Response.json({ result: "duplicate" });
    const relay = createTeamsActivityRelay({ appId, tenantId, recipientId: "bot-recipient", gatewayKey: key,
      openbotUrl: new URL("https://openbot.example.test") }, {
      fetch: async (input) => String(input).endsWith("/gateway-challenge") ? Response.json({ epoch }) : result,
      clock: () => 1_800_000_000_000,
    });
    expect(await relay(activity, objectId)).toEqual({ status: 200, result: "duplicate" });
    result = Response.json({ error: "Unauthorized" }, { status: 401 });
    expect(await relay(activity, objectId)).toEqual({ status: 401, result: "unauthorized" });
  });

  it("recognizes only a personal Teams activity whose sender matches the Microsoft account", () => {
    expect(teamsIdentityMatches(activity, objectId)).toBe(true);
    expect(teamsIdentityMatches(activity, "44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(teamsIdentityMatches({ ...activity, conversation: { id: "group", conversationType: "groupChat" } }, objectId)).toBe(false);
  });
});
