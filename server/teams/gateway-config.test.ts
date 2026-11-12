import { describe, expect, it } from "vitest";
import { teamsGatewayConfig } from "./gateway-config.ts";

const base = {
  OMB_TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111",
  OMB_TEAMS_TENANT_ID: "22222222-2222-4222-8222-222222222222",
  OMB_TEAMS_RECIPIENT_ID: "bot-recipient",
  OMB_TEAMS_CLIENT_SECRET: "fixture-secret",
  OMB_TEAMS_GATEWAY_KEY: Buffer.alloc(32, 7).toString("base64url"),
  OMB_TEAMS_OAUTH_CONNECTION: "OpenBotGraph",
  OMB_TEAMS_OPENBOT_URL: "https://openbot.example.test",
};

describe("Teams gateway configuration", () => {
  it("accepts HTTPS OpenBot endpoints and localhost fixtures", () => {
    expect(teamsGatewayConfig(base).openbotUrl.origin).toBe("https://openbot.example.test");
    expect(teamsGatewayConfig({ ...base, OMB_TEAMS_OPENBOT_URL: "http://127.0.0.1:4311" }).openbotUrl.port).toBe("4311");
  });

  it("rejects remote plaintext, URL credentials and malformed gateway keys", () => {
    expect(() => teamsGatewayConfig({ ...base, OMB_TEAMS_OPENBOT_URL: "http://openbot.example.test" })).toThrow();
    expect(() => teamsGatewayConfig({ ...base, OMB_TEAMS_OPENBOT_URL: "https://user:pass@openbot.example.test" })).toThrow();
    expect(() => teamsGatewayConfig({ ...base, OMB_TEAMS_GATEWAY_KEY: "short" })).toThrow();
  });
});
