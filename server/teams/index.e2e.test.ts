import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { launchCloudSendFixture } from "../../scripts/testing/cloud-send-fixture.ts";

describe("Teams routes in the server", () => {
  it("stays off without configuration and exposes controls only to a current team member when configured", async () => {
    const fx = await launchCloudSendFixture({ onePasswordToken: "ops_fake-teams-fixture", team: { id: "team-test", name: "Test Team" } });
    try {
      const team = fx.team!;
      const owner = (await team.pair({ email: "owner@example.test", role: "owner" })).token!;
      const member = (await team.pair({ email: "member@example.test", role: "member" })).token!;
      const created = await team.as(owner, "POST", "/api/bots", { name: "Teams fixture" });
      expect(created.status).toBe(201);
      const botId = created.body.bot.id as string;
      expect((await team.as(member, "POST", "/api/microsoft-teams/link")).status).toBe(404);
      await team.relaunch({ OMB_TEAMS_ENABLED: "1" });
      expect((await team.as(member, "POST", "/api/microsoft-teams/link")).status).toBe(404);
      const gatewayKey = randomBytes(32);
      await team.relaunch({ OMB_TEAMS_ENABLED: "1", OMB_TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111",
        OMB_TEAMS_TENANT_ID: "22222222-2222-4222-8222-222222222222", OMB_TEAMS_BOT_ID: botId,
        OMB_TEAMS_RECIPIENT_ID: "recipient", OMB_TEAMS_GATEWAY_KEY: gatewayKey.toString("base64url"),
        OMB_TEAMS_CLIENT_SECRET: "fake-client-secret", OMB_TEAMS_SERVICE_ORIGINS: "https://teams.example.test" });
      const linked = await team.as(member, "POST", "/api/microsoft-teams/link");
      expect(linked.status).toBe(200);
      expect(linked.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await team.as(member, "GET", "/api/microsoft-teams/gateway-epoch")).status).toBe(403);
      const epoch = await team.as(owner, "GET", "/api/microsoft-teams/gateway-epoch");
      expect(epoch.status).toBe(200);
      expect(typeof epoch.body.epoch).toBe("string");
      const challenge = await fetch(`${team.base}/api/microsoft-teams/gateway-challenge`, {
        headers: { authorization: `TeamsGatewayKey ${gatewayKey.toString("base64url")}` },
      });
      expect(challenge.status).toBe(200);
      const challengeBody = await challenge.json() as { epoch?: unknown };
      expect(challengeBody.epoch).toBe(epoch.body.epoch);
      const deniedChallenge = await fetch(`${team.base}/api/microsoft-teams/gateway-challenge`, {
        headers: { authorization: `TeamsGatewayKey ${randomBytes(32).toString("base64url")}` },
      });
      expect(deniedChallenge.status).toBe(401);
      const untrusted = await fetch(`${team.base}/api/microsoft-teams/messages`, { method: "POST", headers: { ...fx.edge, "content-type": "application/json" }, body: "{}" });
      expect(untrusted.status).toBe(401);
      expect((await team.as(member, "DELETE", "/api/microsoft-teams/link")).status).toBe(200);
    } finally { await fx.close(); }
  }, 60_000);
});
