const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTeamsAccessToken(config: { appId: string; tenantId: string; clientSecret: string }, options?: {
  fetch?: typeof fetch;
  monotonic?: () => number;
}) {
  if (!GUID.test(config.appId) || !GUID.test(config.tenantId) || !config.clientSecret || config.clientSecret.length > 16_384) {
    throw new Error("Invalid Teams credential configuration");
  }
  const request = options?.fetch ?? fetch;
  const clock = options?.monotonic ?? (() => performance.now());
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  let previous = 0;
  function readClock(): number {
    const current = clock();
    if (!Number.isFinite(current) || current < previous) { cached = undefined; throw new Error("Teams token unavailable"); }
    previous = current;
    return current;
  }

  async function acquire(): Promise<string> {
    const response = await request(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.appId, client_secret: config.clientSecret,
        grant_type: "client_credentials", scope: "https://api.botframework.com/.default" }),
    });
    if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error("Teams token unavailable"); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) throw new Error("Teams token response too large");
        chunks.push(part.value);
      }
    } catch { await reader.cancel().catch(() => {}); throw new Error("Teams token unavailable"); }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
    catch { throw new Error("Teams token unavailable"); }
    if (!parsed || typeof parsed !== "object") throw new Error("Teams token unavailable");
    const value = parsed as Record<string, unknown>;
    if (typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 16_384 || /[\r\n]/.test(value.access_token) ||
      typeof value.expires_in !== "number" || !Number.isSafeInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 86_400) {
      throw new Error("Teams token unavailable");
    }
    const now = readClock();
    cached = { token: value.access_token, until: now + (value.expires_in - 30) * 1000 };
    return value.access_token;
  }

  return async (appId: string): Promise<string> => {
    if (appId !== config.appId) throw new Error("Invalid Teams app");
    const now = readClock();
    if (cached && now < cached.until) return cached.token;
    pending ??= acquire().finally(() => { pending = undefined; });
    return pending;
  };
}
