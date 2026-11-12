import { beforeEach, describe, expect, it, vi } from "vitest";
import { startTeamsGateway } from "./gateway-app.ts";

const sdk = vi.hoisted(() => ({
  app: null as unknown,
  signIn: null as null | (() => Promise<string | undefined>),
}));

vi.mock("@microsoft/teams.apps", () => ({
  App: class {
    handlers = new Map<string, (context: unknown) => Promise<void>>();
    constructor(_config: unknown) { sdk.app = this; }
    addOAuthFlow(_connection: string) {
      return {
        signIn: async () => sdk.signIn?.(),
        onSignInComplete: () => this,
      };
    }
    on(event: string, handler: (context: unknown) => Promise<void>) { this.handlers.set(event, handler); return this; }
    async start(_port: number) {}
    async stop() {}
  },
}));

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const activity = {
  type: "message",
  id: "activity-1",
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/teams",
  channelData: { tenant: { id: tenantId } },
  from: { id: "teams-user", aadObjectId: objectId },
  conversation: { id: "personal-chat", conversationType: "personal" },
  recipient: { id: "bot-recipient" },
  text: "hello OpenBot",
};

type GatewayContext = { activity: typeof activity; send(message: string): Promise<unknown> };
type AppHarness = { handlers: Map<string, (context: GatewayContext) => Promise<void>> };

describe("Teams gateway activity handler", () => {
  beforeEach(() => {
    sdk.app = null;
    sdk.signIn = async () => "fixture-graph-token";
  });

  it("checks Graph identity before relaying a personal message with a signed proof", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : init?.body instanceof Uint8Array ? Buffer.from(init.body).toString("utf8") : undefined;
      requests.push({ url, headers: new Headers(init?.headers), body });
      if (url.startsWith("https://graph.microsoft.com/")) return Response.json({ id: objectId });
      if (url.endsWith("/gateway-challenge")) return Response.json({ epoch: "fixture-epoch" });
      return Response.json({ result: "accepted" });
    };
    const gateway = await startTeamsGateway({ appId, tenantId, recipientId: "bot-recipient", clientSecret: "fixture-secret",
      gatewayKey: Buffer.alloc(32, 9), oauthConnection: "OpenBotGraph", openbotUrl: new URL("https://openbot.example.test"), port: 3978 }, { fetch: fetcher });
    try {
      const sent: string[] = [];
      const handler = (sdk.app as AppHarness).handlers.get("message");
      expect(handler).toBeTypeOf("function");
      await handler!({ activity, send: async (message) => { sent.push(message); } });

      expect(requests.map(({ url }) => url)).toEqual([
        "https://graph.microsoft.com/v1.0/me?$select=id",
        "https://openbot.example.test/api/microsoft-teams/gateway-challenge",
        "https://openbot.example.test/api/microsoft-teams/messages",
      ]);
      expect(requests[0]!.headers.get("authorization")).toBe("Bearer fixture-graph-token");
      expect(requests[2]!.headers.get("authorization")).toMatch(/^TeamsGateway /);
      expect(requests[2]!.headers.get("x-openbot-teams-proof")).toBeTruthy();
      expect(JSON.parse(requests[2]!.body!)).toEqual(activity);
      expect(sent).toEqual([]);
    } finally { await gateway.close(); }
  });

  it("rejects a Graph account that does not match the Teams sender", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return Response.json({ id: "44444444-4444-4444-8444-444444444444" });
    };
    const gateway = await startTeamsGateway({ appId, tenantId, recipientId: "bot-recipient", clientSecret: "fixture-secret",
      gatewayKey: Buffer.alloc(32, 9), oauthConnection: "OpenBotGraph", openbotUrl: new URL("https://openbot.example.test"), port: 3978 }, { fetch: fetcher });
    try {
      const sent: string[] = [];
      await (sdk.app as AppHarness).handlers.get("message")!({ activity, send: async (message) => { sent.push(message); } });
      expect(urls).toEqual(["https://graph.microsoft.com/v1.0/me?$select=id"]);
      expect(sent.join(" ")).toContain("does not match");
    } finally { await gateway.close(); }
  });
});
