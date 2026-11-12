import { App } from "@microsoft/teams.apps";
import { createTeamsActivityRelay, teamsIdentityMatches } from "./activity-relay.ts";
import type { TeamsGatewayConfig } from "./gateway-config.ts";

async function graphObjectId(accessToken: string, fetcher: typeof fetch): Promise<string | null> {
  const response = await fetcher("https://graph.microsoft.com/v1.0/me?$select=id", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const body = await response.text();
  if (body.length > 16_384) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !("id" in parsed) || typeof parsed.id !== "string") return null;
    return parsed.id;
  } catch { return null; }
}

export async function startTeamsGateway(config: TeamsGatewayConfig, options: { fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch ?? fetch;
  const relay = createTeamsActivityRelay(config, { fetch: fetcher });
  const app = new App({ clientId: config.appId, clientSecret: config.clientSecret, tenantId: config.tenantId });
  const oauth = app.addOAuthFlow(config.oauthConnection, {
    oauthCardText: "Sign in with your Microsoft account to use OpenBot.",
    signInButtonText: "Sign in",
  });

  app.on("message", async (context) => {
    const activity = context.activity;
    if (activity.channelId !== "msteams" || activity.conversation?.conversationType !== "personal" ||
        activity.channelData?.tenant?.id !== config.tenantId) {
      await context.send("OpenBot currently supports Teams personal chats only.");
      return;
    }
    const objectId = activity.from?.aadObjectId;
    if (!objectId) {
      await context.send("OpenBot could not verify this Teams account.");
      return;
    }

    let accessToken: string | undefined;
    try { accessToken = await oauth.signIn(context); }
    catch { await context.send("Microsoft sign-in is unavailable. Try again later."); return; }
    if (!accessToken) return;

    try {
      const graphId = await graphObjectId(accessToken, fetcher);
      if (!graphId || !teamsIdentityMatches(activity, graphId)) {
        await context.send("The Microsoft account does not match this Teams chat. Sign in with the same account and try again.");
        return;
      }
      const result = await relay(activity, graphId);
      if (result.result === "linked") await context.send("Your Teams account is linked to OpenBot.");
      else if (result.result === "unauthorized") await context.send("OpenBot could not authorize this message. Link your Teams account in OpenBot Settings and check your access to this bot.");
      else if (result.result === "busy" || result.result === "unavailable") await context.send("OpenBot is temporarily unavailable. Please try again.");
    } catch {
      await context.send("OpenBot could not verify or forward this message. Please try again.");
    }
  });

  oauth.onSignInComplete(async (context) => {
    await context.send("Microsoft sign-in succeeded. Send your message again to continue.");
  });

  await app.start(config.port);
  return { close: () => app.stop() };
}
