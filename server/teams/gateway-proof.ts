import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { TeamsAccountIdentity } from "./account-links.ts";
import { parseTeamsConnectorActivity, type TeamsConnectorActivity } from "./connector-auth.ts";

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
export function createTeamsGatewayProofVerifier(config: { appId: string; key: Uint8Array; epoch?: string; clock?: () => number }) {
  if (!GUID.test(config.appId) || config.key.byteLength < 32) throw new Error("Invalid Teams gateway configuration");
  const key = Uint8Array.from(config.key);
  const audience = `openbot:teams:${config.appId}`;
  const epoch = config.epoch ?? PROCESS_EPOCH;
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
        requiredClaims: ["iat", "nbf", "exp", "jti"], currentDate: new Date(now),
      });
      if (payload.purpose !== "sender-identity" || typeof payload.iat !== "number" || typeof payload.nbf !== "number" || typeof payload.exp !== "number" ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.nbf) || !Number.isSafeInteger(payload.exp) ||
          payload.exp <= payload.iat || payload.exp - payload.iat > MAX_AGE_SECONDS || payload.nbf > payload.exp ||
          payload.gateway_epoch !== epoch || payload.tenant_id !== tenant || payload.object_id !== object || typeof payload.body_sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(payload.body_sha256)) return null;
      const expected = createHash("sha256").update(body).digest();
      const received = Buffer.from(payload.body_sha256, "hex");
      if (!timingSafeEqual(expected, received)) return null;
      return { appId: config.appId, tenantId: tenant, objectId: object };
    } catch { return null; }
  };
  return Object.assign(verify, { epoch });
}

export function createTeamsGatewayProofSigner(config: { appId: string; key: Uint8Array; clock?: () => number }) {
  if (!GUID.test(config.appId) || config.key.byteLength < 32) throw new Error("Invalid Teams gateway configuration");
  const key = Uint8Array.from(config.key);
  const audience = `openbot:teams:${config.appId}`;
  const clock = config.clock ?? processClock;
  async function issue(purpose: "gateway-relay" | "sender-identity", activity: TeamsConnectorActivity, body: Uint8Array, epoch: string, objectId: string) {
    const now = clock();
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(nowSeconds) || body.byteLength > 1_000_000 ||
        !GUID.test(activity.channelData.tenant.id) || !GUID.test(objectId) || objectId !== activity.from.aadObjectId ||
        !epoch || epoch.length > 128) throw new Error("Invalid verified Teams activity");
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    return new SignJWT({
      purpose, tenant_id: activity.channelData.tenant.id, object_id: objectId,
      body_sha256: bodySha256, gateway_epoch: epoch,
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(ISSUER).setAudience(audience)
      .setIssuedAt(nowSeconds).setNotBefore(nowSeconds).setExpirationTime(nowSeconds + MAX_AGE_SECONDS).setJti(randomUUID()).sign(key);
  }
  return async (activity: TeamsConnectorActivity, body: Uint8Array, epoch: string, authenticatedObjectId: string) => ({
    authorization: await issue("gateway-relay", activity, body, epoch, authenticatedObjectId),
    proof: await issue("sender-identity", activity, body, epoch, authenticatedObjectId),
  });
}

export function createTeamsGatewayRelayVerifier(config: { appId: string; tenantId: string; key: Uint8Array; epoch?: string; clock?: () => number }) {
  if (!GUID.test(config.appId) || !GUID.test(config.tenantId) || config.key.byteLength < 32) throw new Error("Invalid Teams gateway configuration");
  const key = Uint8Array.from(config.key);
  const audience = `openbot:teams:${config.appId}`;
  const epoch = config.epoch ?? PROCESS_EPOCH;
  const clock = config.clock ?? processClock;
  return async (authorization: string | undefined, input: unknown): Promise<TeamsConnectorActivity> => {
    const match = /^TeamsGateway ([A-Za-z0-9_.-]+)$/.exec(authorization ?? "");
    if (!match || match[1]!.length > 16_384) throw new Error("Invalid Teams gateway authorization");
    const activity = parseTeamsConnectorActivity(input, config.tenantId);
    const objectId = activity.from.aadObjectId;
    if (!objectId || !GUID.test(objectId)) throw new Error("Missing authenticated Teams sender");
    try {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid clock");
      const { payload } = await jwtVerify(match[1]!, key, {
        algorithms: ["HS256"], issuer: ISSUER, audience, maxTokenAge: MAX_AGE_SECONDS,
        requiredClaims: ["iat", "nbf", "exp", "jti"], currentDate: new Date(now),
      });
      const canonicalBody = new TextEncoder().encode(JSON.stringify(input));
      const expected = createHash("sha256").update(canonicalBody).digest();
      const received = typeof payload.body_sha256 === "string" && /^[0-9a-f]{64}$/.test(payload.body_sha256)
        ? Buffer.from(payload.body_sha256, "hex") : Buffer.alloc(0);
      if (payload.purpose !== "gateway-relay" || payload.tenant_id !== config.tenantId || payload.object_id !== objectId ||
          payload.gateway_epoch !== epoch || typeof payload.iat !== "number" || typeof payload.nbf !== "number" ||
          typeof payload.exp !== "number" || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.nbf) ||
          !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > MAX_AGE_SECONDS ||
          payload.nbf > payload.exp || received.length !== expected.length || !timingSafeEqual(expected, received)) {
        throw new Error("Invalid Teams gateway authorization");
      }
      return activity;
    } catch { throw new Error("Invalid Teams gateway authorization"); }
  };
}
