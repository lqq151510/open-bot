import { createTeamsGatewayProofSigner } from "./gateway-proof.ts";
import { parseTeamsConnectorActivity } from "./connector-auth.ts";

export interface TeamsRelayResult {
  status: number;
  result?: "accepted" | "linked" | "duplicate" | "ignored" | "unauthorized" | "conflict" | "busy" | "unavailable";
}

export function createTeamsActivityRelay(config: {
  appId: string;
  tenantId: string;
  recipientId: string;
  gatewayKey: Uint8Array;
  openbotUrl: URL;
}, options: { fetch?: typeof fetch; clock?: () => number } = {}) {
  const fetcher = options.fetch ?? fetch;
  const sign = createTeamsGatewayProofSigner({ appId: config.appId, key: config.gatewayKey, clock: options.clock });
  const root = new URL(config.openbotUrl);
  async function request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetcher(new URL(path, root), { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (response.headers.get("content-length") && Number(response.headers.get("content-length")) > 16_384) throw new Error("Teams gateway response too large");
    return response;
  }
  return async function relay(input: unknown, authenticatedObjectId: string): Promise<TeamsRelayResult> {
    const activity = parseTeamsConnectorActivity(input, config.tenantId);
    if (activity.channelId !== "msteams" || activity.conversation.conversationType !== "personal" ||
        activity.recipient.id !== config.recipientId || activity.from.aadObjectId !== authenticatedObjectId) {
      throw new Error("Teams identity does not match the activity");
    }
    const body = Buffer.from(JSON.stringify(input));
    if (body.byteLength > 1_000_000) throw new Error("Teams activity too large");
    const challengeResponse = await request("/api/microsoft-teams/gateway-challenge", {
      method: "GET", headers: { authorization: `TeamsGatewayKey ${Buffer.from(config.gatewayKey).toString("base64url")}` },
    });
    if (!challengeResponse.ok) throw new Error("OpenBot Teams gateway is unavailable");
    const challengeText = await challengeResponse.text();
    if (challengeText.length > 4_096) throw new Error("Invalid OpenBot Teams challenge");
    let challenge: unknown;
    try { challenge = JSON.parse(challengeText); } catch { throw new Error("Invalid OpenBot Teams challenge"); }
    const epoch = challenge && typeof challenge === "object" && "epoch" in challenge ? challenge.epoch : undefined;
    if (typeof epoch !== "string" || epoch.length > 128) throw new Error("Invalid OpenBot Teams challenge");
    const proof = await sign(activity, body, epoch, authenticatedObjectId);
    const response = await request("/api/microsoft-teams/messages", {
      method: "POST",
      headers: { authorization: `TeamsGateway ${proof.authorization}`, "x-openbot-teams-proof": proof.proof, "content-type": "application/json" },
      body,
    });
    const responseText = await response.text();
    if (responseText.length > 4_096) throw new Error("Invalid OpenBot Teams response");
    let decoded: unknown;
    try { decoded = JSON.parse(responseText); } catch { throw new Error("Invalid OpenBot Teams response"); }
    const result = decoded && typeof decoded === "object" && "result" in decoded ? decoded.result : undefined;
    if (response.status === 401) return { status: response.status, result: "unauthorized" };
    if (response.status === 409) return { status: response.status, result: "conflict" };
    if (response.status === 503) return { status: response.status, result: result === "busy" ? "busy" : "unavailable" };
    if (!response.ok || !["accepted", "linked", "duplicate", "ignored"].includes(String(result))) return { status: response.status || 503, result: "unavailable" };
    return { status: response.status, result: result as TeamsRelayResult["result"] };
  };
}

export function teamsIdentityMatches(activity: {
  channelId?: string;
  conversation?: { id?: string; conversationType?: string };
  from?: { aadObjectId?: string };
}, graphObjectId: string): boolean {
  return activity.channelId === "msteams" && activity.conversation?.conversationType === "personal" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(graphObjectId) &&
    activity.from?.aadObjectId?.toLowerCase() === graphObjectId.toLowerCase();
}
