import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { TeamsAccountLinks, type TeamsAccountIdentity } from "./account-links.ts";
import { TeamsActivityInbox } from "./activity-inbox.ts";
import { createTeamsConnectorVerifier, type TeamsConnectorActivity } from "./connector-auth.ts";
import { createTeamsGatewayProofVerifier } from "./gateway-proof.ts";
import { createTeamsInbound, type TeamsInboundDependencies, type TeamsInboundResult } from "./inbound.ts";

export interface TeamsHost {
  isCurrentMember(memberId: string): boolean;
  resolveBot: TeamsInboundDependencies["resolveBot"];
  authorize: TeamsInboundDependencies["authorize"];
  /** Recheck the identity, membership, bot and conversation permissions when durably accepting a sendId. */
  send(input: Parameters<TeamsInboundDependencies["send"]>[0] & { activity: TeamsConnectorActivity; linkGeneration: string; isLinked(): boolean }): Promise<"accepted" | "unauthorized">;
}

export interface TeamsServiceConfig {
  appId: string;
  tenantId: string;
  gatewayKey: Uint8Array;
  dataDir: string;
}

export type TeamsServiceResult = TeamsInboundResult | "linked";

export function createTeamsService(config: TeamsServiceConfig, host: TeamsHost, options?: {
  verifyConnector?: TeamsInboundDependencies["verifyConnector"];
}) {
  const verifyConnector = options?.verifyConnector ?? createTeamsConnectorVerifier(config);
  const verifySender = createTeamsGatewayProofVerifier({ appId: config.appId, key: config.gatewayKey });
  const links = new TeamsAccountLinks(join(config.dataDir, "teams-account-links.sqlite"));
  let inbox: TeamsActivityInbox;
  try { inbox = new TeamsActivityInbox(join(config.dataDir, "teams-activity-inbox.sqlite")); }
  catch (error) { links.close(); throw error; }

  async function receive(authorization: string | undefined, rawBody: Uint8Array, proof?: string): Promise<TeamsServiceResult> {
    if (rawBody.byteLength > 1_000_000) return "unauthorized";
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)); }
    catch { return "unauthorized"; }
    let activity: TeamsConnectorActivity;
    let identity: TeamsAccountIdentity | null;
    try {
      activity = await verifyConnector(authorization, body);
      identity = await verifySender(activity, rawBody, proof);
    } catch { return "unauthorized"; }
    if (!identity || identity.appId !== config.appId || identity.tenantId !== config.tenantId ||
        identity.tenantId !== activity.channelData.tenant.id || identity.objectId !== activity.from.aadObjectId) return "unauthorized";

    const text = activity.text?.trim() ?? "";
    if (text.startsWith("/openbot-link")) {
      const match = /^\/openbot-link ([A-Za-z0-9_-]{43})$/.exec(text);
      if (!match) return "unauthorized";
      try {
        return links.consume(match[1]!, identity, activity.conversation.conversationType === "personal", host.isCurrentMember)
          ? "linked" : "unauthorized";
      } catch { return "unauthorized"; }
    }

    const inbound = createTeamsInbound({
      appId: config.appId,
      verifyConnector: async () => activity,
      verifySender: async () => identity,
      resolveMember: (sender) => links.resolve(sender, host.isCurrentMember),
      resolveBot: host.resolveBot,
      authorize: host.authorize,
      claim: (key, raw) => inbox.claim(key, raw),
      complete: (sendId, lease) => inbox.complete(sendId, lease),
      send: (input) => {
        const generation = links.generation(input.identity, input.memberId, host.isCurrentMember);
        if (!generation) return Promise.resolve("unauthorized" as const);
        return host.send({ ...input, activity, linkGeneration: generation,
          isLinked: () => links.generation(input.identity, input.memberId, host.isCurrentMember) === generation });
      },
    });
    try { return await inbound(authorization, rawBody, proof); }
    catch { return "unavailable"; }
  }

  return {
    gatewayEpoch: verifySender.epoch,
    authorizeGatewayKey(value: string | undefined) {
      const match = /^TeamsGatewayKey ([A-Za-z0-9_-]{43})$/.exec(value ?? "");
      if (!match) return false;
      const candidate = Buffer.from(match[1]!, "base64url");
      return candidate.length === config.gatewayKey.length && timingSafeEqual(candidate, config.gatewayKey);
    },
    issueLink(memberId: string) {
      if (!host.isCurrentMember(memberId)) throw new Error("Unknown member");
      return links.issue({ appId: config.appId, tenantId: config.tenantId, memberId });
    },
    revokeLink(memberId: string) { links.revoke(config.appId, config.tenantId, memberId); },
    linkCurrent(identity: TeamsAccountIdentity, memberId: string, generation: string) {
      try { return links.generation(identity, memberId, host.isCurrentMember) === generation; } catch { return false; }
    },
    receive,
    close() { inbox.close(); links.close(); },
  };
}
