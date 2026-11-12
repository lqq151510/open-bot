import { z } from "zod";
import type { TeamsAccountIdentity } from "./account-links.ts";
import type { ActivityClaim, TeamsActivityKey } from "./activity-inbox.ts";
import type { TeamsConnectorActivity } from "./connector-auth.ts";

const mentions = z.object({
  entities: z.array(z.object({ type: z.string(), mentioned: z.object({ id: z.string() }).optional() })).max(100).optional(),
});

export interface TeamsInboundDependencies {
  appId: string;
  verifyConnector(authorization: string | undefined, body: unknown): Promise<TeamsConnectorActivity>;
  /** Independently verifies sender identity against this exact activity; the Connector bearer alone does not bind its body. */
  verifySender(activity: TeamsConnectorActivity, rawBody: Uint8Array, proof?: string): Promise<TeamsAccountIdentity | null>;
  resolveMember(identity: TeamsAccountIdentity): string | null;
  /** Resolves a published, currently enabled team Bot from its registered Teams recipient. */
  resolveBot(input: { appId: string; tenantId: string; recipientId: string }): string | null;
  /** Checks current membership and bot/conversation access without creating a conversation or other side effects. */
  authorize(input: { memberId: string; tenantId: string; botId: string; conversationId: string; conversationType: string }): Promise<boolean>;
  claim(key: TeamsActivityKey, rawBody: Uint8Array): ActivityClaim;
  complete(sendId: string, lease: string): boolean;
  /** Rechecks the identity, membership and Bot authorization at durable acceptance, atomically with the deduplicated sendId. */
  send(input: { identity: TeamsAccountIdentity; recipientId: string; memberId: string; botId: string; tenantId: string; conversationId: string; conversationType: string; text: string; sendId: string }): Promise<"accepted" | "unauthorized">;
}

export type TeamsInboundResult = "accepted" | "duplicate" | "busy" | "ignored" | "unauthorized" | "conflict" | "unavailable";

export function createTeamsInbound(deps: TeamsInboundDependencies) {
  return async (authorization: string | undefined, rawBody: Uint8Array, senderProof?: string): Promise<TeamsInboundResult> => {
    if (rawBody.byteLength > 1_000_000) return "unauthorized";
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)); }
    catch { return "unauthorized"; }
    let activity: TeamsConnectorActivity;
    try { activity = await deps.verifyConnector(authorization, body); }
    catch { return "unauthorized"; }
    const sender = await deps.verifySender(activity, rawBody, senderProof);
    if (!sender || sender.appId !== deps.appId || sender.tenantId !== activity.channelData.tenant.id || sender.objectId !== activity.from.aadObjectId) return "unauthorized";
    const conversationType = activity.conversation.conversationType;
    if (conversationType !== "personal" && conversationType !== "groupChat" && conversationType !== "channel") return "unauthorized";
    if (conversationType !== "personal") {
      const parsed = mentions.safeParse(body);
      if (!parsed.success || !parsed.data.entities?.some((entity) => entity.type === "mention" && entity.mentioned?.id === activity.recipient.id)) return "ignored";
    }
    const text = activity.text?.trim();
    if (!text) return "ignored";
    const memberId = deps.resolveMember(sender);
    const botLookup = { appId: sender.appId, tenantId: sender.tenantId, recipientId: activity.recipient.id };
    const botId = deps.resolveBot(botLookup);
    if (!memberId || !botId) return "unauthorized";
    const input = { memberId, tenantId: sender.tenantId, botId, conversationId: activity.conversation.id, conversationType };
    if (!await deps.authorize(input)) return "unauthorized";
    const key = { appId: sender.appId, tenantId: sender.tenantId, conversationId: activity.conversation.id, activityId: activity.id };
    const claim = deps.claim(key, rawBody);
    if (claim.state === "done") return "duplicate";
    if (claim.state === "busy") return "busy";
    if (claim.state === "conflict") return "conflict";
    if (claim.state !== "claimed") return "unavailable";
    if (deps.resolveMember(sender) !== memberId || deps.resolveBot(botLookup) !== botId || !await deps.authorize(input)) return "unauthorized";
    const accepted = await deps.send({ ...input, identity: sender, recipientId: activity.recipient.id, text, sendId: claim.sendId });
    if (accepted !== "accepted") return "unauthorized";
    return deps.complete(claim.sendId, claim.lease) ? "accepted" : "busy";
  };
}
