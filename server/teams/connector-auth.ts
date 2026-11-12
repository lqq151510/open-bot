import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";

const KEYS_URL = "https://login.botframework.com/v1/.well-known/keys";
const ISSUER = "https://api.botframework.com";
const CACHE_MS = 24 * 60 * 60_000;
const REFRESH_COOLDOWN_MS = 30_000;
const ID = z.string().min(1).max(512);
const activitySchema = z.object({
  type: z.literal("message"),
  id: ID,
  channelId: z.literal("msteams"),
  serviceUrl: z.string().min(1).max(2048),
  channelData: z.object({ tenant: z.object({ id: ID }) }),
  from: z.object({ id: ID, aadObjectId: ID.optional() }),
  conversation: z.object({ id: ID, conversationType: ID.optional() }),
  recipient: z.object({ id: ID }),
  text: z.string().max(100_000).optional(),
});

type EndorsedJwk = JSONWebKeySet["keys"][number] & { endorsements?: unknown };
type KeySource = (force: boolean) => Promise<JSONWebKeySet>;

function publicKeys(): KeySource {
  let cached: JSONWebKeySet | undefined;
  let fetchedAt = 0;
  let lastAttempt = 0;
  let pending: Promise<JSONWebKeySet> | undefined;
  return async (force) => {
    const now = Date.now();
    if (cached && now - fetchedAt < CACHE_MS && (!force || now - lastAttempt < REFRESH_COOLDOWN_MS)) return cached;
    if (pending) return pending;
    lastAttempt = now;
    pending = (async () => {
      const response = await fetch(KEYS_URL, { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Teams signing keys unavailable");
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error("Teams signing keys invalid");
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as JSONWebKeySet).keys)) throw new Error("Teams signing keys invalid");
      cached = parsed as JSONWebKeySet;
      fetchedAt = Date.now();
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

export type TeamsConnectorActivity = z.infer<typeof activitySchema>;

export function parseTeamsConnectorActivity(input: unknown, tenantId: string): TeamsConnectorActivity {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success || parsed.data.channelData.tenant.id !== tenantId) throw new Error("Invalid Teams activity");
  let url: URL;
  try { url = new URL(parsed.data.serviceUrl); } catch { throw new Error("Invalid Teams service URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Invalid Teams service URL");
  return parsed.data;
}

/** Connector authentication does not cryptographically bind the activity body, tenant, or sender to the token; authorize and deduplicate separately before acting. */
export function createTeamsConnectorVerifier(config: { appId: string; tenantId: string }, getKeys: KeySource = publicKeys()) {
  if (!config.appId.trim() || !config.tenantId.trim()) throw new Error("Teams app and tenant are required");
  return async (authorization: string | undefined, input: unknown): Promise<TeamsConnectorActivity> => {
    const activity = parseTeamsConnectorActivity(input, config.tenantId);
    const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization ?? "");
    if (!bearer || bearer[1]!.length > 16_384) throw new Error("Invalid Teams authorization");

    const eligible = (set: JSONWebKeySet) => ({ keys: set.keys.filter((key: EndorsedJwk) =>
      key.kty === "RSA" && key.use === "sig" && (!key.alg || key.alg === "RS256") && Array.isArray(key.endorsements) && key.endorsements.includes("msteams")) });
    const verify = (keys: JSONWebKeySet) => jwtVerify(bearer[1]!, createLocalJWKSet(eligible(keys)), {
      algorithms: ["RS256"], issuer: ISSUER, audience: config.appId, requiredClaims: ["exp", "nbf", "serviceurl"], clockTolerance: 300,
    });
    let result: Awaited<ReturnType<typeof verify>>;
    try { result = await verify(await getKeys(false)); }
    catch {
      try { result = await verify(await getKeys(true)); }
      catch { throw new Error("Invalid Teams authorization"); }
    }
    if (result.payload.serviceurl !== activity.serviceUrl) throw new Error("Invalid Teams service URL");
    return activity;
  };
}
