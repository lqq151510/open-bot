import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createTeamsConnectorVerifier } from "./connector-auth.ts";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let keys: JSONWebKeySet;
const appId = "app-id";
const tenantId = "tenant-id";
const serviceUrl = "https://smba.trafficmanager.net/teams/";
const activity = () => ({ type: "message", id: "activity", channelId: "msteams", serviceUrl,
  channelData: { tenant: { id: tenantId } }, from: { id: "person", aadObjectId: "object-id" },
  conversation: { id: "conversation", conversationType: "personal" }, recipient: { id: "bot" }, text: "hello" });

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const key = { ...await exportJWK(pair.publicKey), kid: "fixture", use: "sig", alg: "RS256", endorsements: ["msteams"] };
  keys = { keys: [key] };
});

async function token(options: { aud?: string; iss?: string; url?: string; expired?: boolean; noNbf?: boolean; kid?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ serviceurl: options.url ?? serviceUrl }).setProtectedHeader({ alg: "RS256", kid: options.kid ?? "fixture" })
    .setIssuer(options.iss ?? "https://api.botframework.com").setAudience(options.aud ?? appId)
    .setExpirationTime(options.expired ? now - 600 : now + 600);
  if (!options.noNbf) jwt = jwt.setNotBefore(now - 10);
  return `Bearer ${await jwt.sign(privateKey)}`;
}

describe("Teams Connector authentication", () => {
  it("accepts a signed, endorsed Teams activity for the configured app and tenant", async () => {
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => keys);
    expect(await verify(await token(), activity())).toEqual(activity());
  });

  it("rejects untrusted issuer, audience, expiry, missing claims, and invalid signing keys", async () => {
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => keys);
    for (const auth of [await token({ iss: "https://attacker.example" }), await token({ aud: "other" }),
      await token({ expired: true }), await token({ noNbf: true }), await token({ kid: "unknown" }), "Bearer invalid", undefined]) {
      await expect(verify(auth, activity())).rejects.toThrow();
    }
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ serviceurl: serviceUrl }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer("https://api.botframework.com").setAudience(appId).setNotBefore("0s").setExpirationTime("10m").sign(other.privateKey);
    await expect(verify(`Bearer ${forged}`, activity())).rejects.toThrow();
  });

  it("requires the documented lowercase JWT claim while matching the activity's camel-case property", async () => {
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => keys);
    const camelCaseClaim = await new SignJWT({ serviceUrl }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer("https://api.botframework.com").setAudience(appId).setNotBefore("0s").setExpirationTime("10m").sign(privateKey);
    await expect(verify(`Bearer ${camelCaseClaim}`, activity())).rejects.toThrow();
    await expect(verify(await token(), activity())).resolves.toEqual(activity());
  });

  it("requires a Teams-endorsed key and matching service URL", async () => {
    const unendorsed = { keys: keys.keys.map((key) => ({ ...key, endorsements: ["other"] })) };
    const verifyUnendorsed = createTeamsConnectorVerifier({ appId, tenantId }, async () => unendorsed);
    await expect(verifyUnendorsed(await token(), activity())).rejects.toThrow();
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => keys);
    await expect(verify(await token({ url: "https://other.example/" }), activity())).rejects.toThrow();
    await expect(verify(await token({ url: "http://127.0.0.1/" }), { ...activity(), serviceUrl: "http://127.0.0.1/" })).rejects.toThrow();
  });

  it("rejects a different tenant or channel before accepting a message", async () => {
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => keys);
    const auth = await token();
    await expect(verify(auth, { ...activity(), channelId: "other" })).rejects.toThrow();
    await expect(verify(auth, { ...activity(), channelData: { tenant: { id: "other" } } })).rejects.toThrow();
  });

  it("verifies using a loopback key service without a real Teams account", async () => {
    const server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(keys)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const verify = createTeamsConnectorVerifier({ appId, tenantId }, async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}/keys`);
        return response.json() as Promise<JSONWebKeySet>;
      });
      await expect(verify(await token(), activity())).resolves.toEqual(activity());
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("refreshes keys for an unknown key id", async () => {
    const calls: boolean[] = [];
    const verify = createTeamsConnectorVerifier({ appId, tenantId }, async (force) => {
      calls.push(force);
      return force ? keys : { keys: [] };
    });
    await expect(verify(await token(), activity())).resolves.toEqual(activity());
    expect(calls).toEqual([false, true]);
  });
});
