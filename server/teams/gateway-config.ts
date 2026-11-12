const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TeamsGatewayConfig {
  appId: string;
  tenantId: string;
  recipientId: string;
  clientSecret: string;
  gatewayKey: Uint8Array;
  oauthConnection: string;
  openbotUrl: URL;
  port: number;
}

export function teamsGatewayConfig(env: Record<string, string | undefined>): TeamsGatewayConfig {
  const appId = env.OMB_TEAMS_APP_ID;
  const tenantId = env.OMB_TEAMS_TENANT_ID;
  const recipientId = env.OMB_TEAMS_RECIPIENT_ID;
  const clientSecret = env.OMB_TEAMS_CLIENT_SECRET;
  const encodedKey = env.OMB_TEAMS_GATEWAY_KEY;
  const connection = env.OMB_TEAMS_OAUTH_CONNECTION;
  const openbot = env.OMB_TEAMS_OPENBOT_URL;
  const port = Number(env.OMB_TEAMS_GATEWAY_PORT ?? "3978");
  if (!appId || !GUID.test(appId) || !tenantId || !GUID.test(tenantId) || !recipientId || recipientId.length > 512 || !clientSecret || clientSecret.length > 16_384 ||
      !encodedKey || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey) || !connection || connection.length > 128 ||
      !openbot || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid Microsoft Teams gateway configuration");
  const gatewayKey = Buffer.from(encodedKey, "base64url");
  if (gatewayKey.length !== 32 || gatewayKey.toString("base64url") !== encodedKey) throw new Error("Invalid Microsoft Teams gateway configuration");
  let openbotUrl: URL;
  try { openbotUrl = new URL(openbot); } catch { throw new Error("Invalid Microsoft Teams gateway configuration"); }
  const local = openbotUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(openbotUrl.hostname);
  if ((!local && openbotUrl.protocol !== "https:") || openbotUrl.username || openbotUrl.password || openbotUrl.search || openbotUrl.hash ||
      !["", "/"].includes(openbotUrl.pathname)) throw new Error("Invalid Microsoft Teams gateway configuration");
  return { appId, tenantId, recipientId, clientSecret, gatewayKey, oauthConnection: connection, openbotUrl, port };
}
