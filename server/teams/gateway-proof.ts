import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import type { TeamsAccountIdentity } from "./account-links.ts";
import type { TeamsConnectorActivity } from "./connector-auth.ts";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUER = "openbot-teams-gateway";
const MAX_AGE_SECONDS = 60;
const PROCESS_EPOCH = randomBytes(32).toString("base64url");

export function createTeamsGatewayClock(wall: () => number, monotonic: () => number): () => number {
  let effective = wall();
  let previous = Math.floor(monotonic());
  if (!Number.isSafeInteger(effective) || effective < 0 || !Number.isSafeInteger(previous) || previous < 0) throw new Error("Invalid clock");
  return () => {
    const current = wall();
    const tick = Math.floor(monotonic());
    if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(tick) || tick < previous) throw new Error("Invalid clock");
    const next = Math.max(current, effective + tick - previous);
    if (!Number.isSafeInteger(next)) throw new Error("Invalid clock");
    previous = tick;
    effective = next;
    return effective;
  };
}

const processClock = createTeamsGatewayClock(Date.now, () => performance.now());

/** The issuer must independently authenticate the Teams user and bind the exact received activity before signing. */
export function createTeamsGatewayProofVerifier(config: { appId: string; key: Uint8Array; clock?: () => number }) {
  if (!GUID.test(config.appId) || config.key.byteLength < 32) throw new Error("Invalid Teams gateway configuration");
  const key = Uint8Array.from(config.key);
  const audience = `openbot:teams:${config.appId}`;
  const clock = config.clock ?? processClock;
  const verify = async (activity: TeamsConnectorActivity, body: Uint8Array, proof?: string): Promise<TeamsAccountIdentity | null> => {
    if (!proof || proof.length > 16_384 || body.byteLength > 1_000_000) return null;
    const tenant = activity.channelData.tenant.id;
    const object = activity.from.aadObjectId;
    if (!GUID.test(tenant) || !object || !GUID.test(object)) return null;
    try {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) return null;
      const { payload } = await jwtVerify(proof, key, {
        algorithms: ["HS256"], issuer: ISSUER, audience, maxTokenAge: MAX_AGE_SECONDS,
        requiredClaims: ["iat", "nbf", "exp"], currentDate: new Date(now),
      });
      if (typeof payload.iat !== "number" || typeof payload.nbf !== "number" || typeof payload.exp !== "number" ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.nbf) || !Number.isSafeInteger(payload.exp) ||
          payload.exp <= payload.iat || payload.exp - payload.iat > MAX_AGE_SECONDS || payload.nbf > payload.exp ||
          payload.gateway_epoch !== PROCESS_EPOCH || payload.tenant_id !== tenant || payload.object_id !== object || typeof payload.body_sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(payload.body_sha256)) return null;
      const expected = createHash("sha256").update(body).digest();
      const received = Buffer.from(payload.body_sha256, "hex");
      if (!timingSafeEqual(expected, received)) return null;
      return { appId: config.appId, tenantId: tenant, objectId: object };
    } catch { return null; }
  };
  return Object.assign(verify, { epoch: PROCESS_EPOCH });
}
