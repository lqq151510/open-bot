const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function teamsConfig(env: NodeJS.ProcessEnv) {
  if (env.OMB_TEAMS_ENABLED !== "1") return null;
  const { OMB_TEAMS_APP_ID: appId, OMB_TEAMS_TENANT_ID: tenantId, OMB_TEAMS_BOT_ID: botId,
    OMB_TEAMS_RECIPIENT_ID: recipientId, OMB_TEAMS_GATEWAY_KEY: encodedKey,
    OMB_TEAMS_CLIENT_SECRET: clientSecret, OMB_TEAMS_SERVICE_ORIGINS: origins } = env;
  if (!appId || !GUID.test(appId) || !tenantId || !GUID.test(tenantId) || !botId || !/^[\w-]{1,128}$/.test(botId) ||
    !recipientId || recipientId.length > 512 || !encodedKey || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey) ||
    !clientSecret || clientSecret.length > 16_384 || !origins) throw new Error("Invalid Teams configuration");
  const gatewayKey = Buffer.from(encodedKey, "base64url");
  if (gatewayKey.length !== 32 || gatewayKey.toString("base64url") !== encodedKey) throw new Error("Invalid Teams configuration");
  const allowedServiceOrigins = origins.split(",").map((origin) => origin.trim());
  if (!allowedServiceOrigins.length || allowedServiceOrigins.length > 10) throw new Error("Invalid Teams configuration");
  for (const origin of allowedServiceOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("Invalid Teams configuration"); }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== origin) {
      throw new Error("Invalid Teams configuration");
    }
  }
  return { appId, tenantId, botId, recipientId, gatewayKey, clientSecret, allowedServiceOrigins };
}
