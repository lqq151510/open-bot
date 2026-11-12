import { join } from "node:path";
import { createTeamsAccessToken } from "./access-token.ts";
import { TeamsConversationStore } from "./conversation-store.ts";
import { createTeamsOutbound, type TeamsReplyTarget } from "./outbound.ts";
import { createTeamsService } from "./service.ts";
import { createTeamsGatewayRelayVerifier } from "./gateway-proof.ts";
import type { TeamsInboundDependencies } from "./inbound.ts";

export interface TeamsHostPerson { email: string; role: "owner" | "admin" | "member"; admin: boolean }
export interface TeamsRuntimeDependencies {
  personFor(memberId: string): TeamsHostPerson | null;
  botGeneration(botId: string): string | null;
  canUse(person: TeamsHostPerson, botId: string): boolean;
  createPrivateThread(botId: string, person: TeamsHostPerson): string | null;
  isPrivateThread(threadId: string, botId: string, person: TeamsHostPerson): boolean;
  /** The guard is checked synchronously at the durable send boundary. */
  accept(input: { botId: string; threadId: string; text: string; sendId: string; person: TeamsHostPerson;
    guard(): boolean; onSettled(result: { ok: boolean; text: string }): void }): Promise<"accepted" | "unauthorized">;
}

export function createTeamsHost(config: { appId: string; tenantId: string; gatewayKey: Uint8Array; clientSecret: string;
  allowedServiceOrigins: string[]; botId: string; recipientId: string; dataDir: string }, deps: TeamsRuntimeDependencies, options?: {
  fetch?: typeof fetch; verifyConnector?: TeamsInboundDependencies["verifyConnector"];
}) {
  const accessToken = createTeamsAccessToken(config, { fetch: options?.fetch });
  const verifyConnector = options?.verifyConnector ?? createTeamsGatewayRelayVerifier({ appId: config.appId, tenantId: config.tenantId, key: config.gatewayKey });
  const conversations = new TeamsConversationStore(join(config.dataDir, "teams-conversations.sqlite"));
  const keyFor = (target: TeamsReplyTarget) => ({ appId: target.appId, tenantId: target.tenantId, botId: target.botId,
    botGeneration: target.botGeneration, memberId: target.memberId, conversationId: target.conversationId });
  const authorizeReply = (target: TeamsReplyTarget) => {
    const person = deps.personFor(target.memberId);
    const thread = conversations.threadFor(keyFor(target));
    return Boolean(person && target.memberGeneration === target.memberId && deps.botGeneration(target.botId) === target.botGeneration &&
      deps.canUse(person, target.botId) && thread && deps.isPrivateThread(thread, target.botId, person));
  };
  let outbound: ReturnType<typeof createTeamsOutbound<string>>;
  try { outbound = createTeamsOutbound<string>({
    appId: config.appId, allowedServiceOrigins: config.allowedServiceOrigins, accessToken, fetch: options?.fetch,
    authenticateCaller: async (sendId) => {
      const target = conversations.replyFor(sendId), who = conversations.replyIdentityFor(sendId);
      return target && who && who.identity.appId === target.appId && who.identity.tenantId === target.tenantId &&
        service.linkCurrent(who.identity, target.memberId, who.linkGeneration) && authorizeReply(target) ? target : null;
    },
    resolveTarget: async (sendId) => conversations.replyFor(sendId),
    authorize: async (_actor, target) => authorizeReply(target),
  }); } catch (error) { conversations.close(); throw error; }
  let closed = false;
  const deliver = async (sendId: string, text: string) => {
    if (closed || !text.trim() || !conversations.claimReply(sendId)) return;
    const result = await outbound(sendId, sendId, text);
    if (!closed) conversations.finishReply(sendId, result.state === "sent" ? "sent" : result.state === "unknown" ? "unknown" : "unavailable");
  };
  let service: ReturnType<typeof createTeamsService>;
  try {
    service = createTeamsService(config, {
      isCurrentMember: (memberId) => deps.personFor(memberId) !== null,
      resolveBot: ({ appId, tenantId, recipientId }) =>
        appId === config.appId && tenantId === config.tenantId && recipientId === config.recipientId && deps.botGeneration(config.botId)
          ? config.botId : null,
      authorize: async ({ memberId, botId, conversationType }) => {
        const person = deps.personFor(memberId);
        return Boolean(conversationType === "personal" && person && deps.canUse(person, botId));
      },
      send: async (input) => {
        const person = deps.personFor(input.memberId);
        const generation = deps.botGeneration(input.botId);
        if (!person || !generation || !input.isLinked() || !deps.canUse(person, input.botId)) return "unauthorized";
        const key = { appId: config.appId, tenantId: input.tenantId, botId: input.botId, botGeneration: generation,
          memberId: input.memberId, conversationId: input.conversationId };
        let threadId = conversations.threadFor(key);
        if (!threadId) {
          threadId = deps.createPrivateThread(input.botId, person);
          if (!threadId || !deps.isPrivateThread(threadId, input.botId, person) || !conversations.bindThread(key, threadId)) return "unauthorized";
        }
        const target: TeamsReplyTarget = { ...key, memberGeneration: input.memberId, activityId: input.activity.id, serviceUrl: input.activity.serviceUrl };
        if (!conversations.bindReply(input.sendId, target, input.identity, input.linkGeneration)) return "unauthorized";
        const chosenThread = threadId;
        const guard = () => {
          const current = deps.personFor(input.memberId);
          return Boolean(current && current.email === person.email && input.isLinked() && deps.botGeneration(input.botId) === generation &&
            deps.canUse(current, input.botId) && conversations.threadFor(key) === chosenThread && deps.isPrivateThread(chosenThread, input.botId, current));
        };
        if (!guard()) return "unauthorized";
        return deps.accept({ botId: input.botId, threadId, text: input.text, sendId: input.sendId, person, guard,
          onSettled: (result) => { if (result.ok && result.text.trim()) void deliver(input.sendId, result.text).catch(() => {}); } });
      },
    }, { verifyConnector });
  } catch (error) { conversations.close(); throw error; }
  return { service, authorizeGatewayKey: service.authorizeGatewayKey, close() { closed = true; service.close(); conversations.close(); } };
}
