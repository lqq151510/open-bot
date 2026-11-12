import { currentDecisionActor, type DecisionRow } from "./decision-log.ts";
import { UNDO_STALE, type DirectApply } from "./direct-apply.ts";
import { TeamMemoryConflict, type TeamMemory, type TeamMemoryInput } from "./team-memory.ts";
import type { OptionCardData } from "../shared/wire.ts";

type Speaker = { id: string; name: string; color: string; section?: string };
type Card = OptionCardData;

export interface TeamMemoryRequestDeps {
  teamMemory: Pick<TeamMemory, "propose" | "resolve" | "resolveProposal" | "undoAccept" | "list" | "reviewReceipts" | "untrustedProposal" | "matchesCard">;
  store: {
    messagesFor(threadId: string): Array<{ id: string; card?: Card; from?: { botId: string } }>;
    appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: Card; from?: { botId: string; name: string; color: string } }): { id: string };
    patchMessage(threadId: string, messageId: string, patch: { card: Card }): unknown;
    bot(id: string): { id: string; name: string } | null | undefined;
    botByThread(threadId: string): { id: string; name: string } | null | undefined;
  };
  threadExists?(threadId: string): boolean;
  requireReview?: boolean;
  sectionKey(section: string | undefined): string;
  decide(row: Omit<DecisionRow, "at">): void;
  audit?(id: string, row: DecisionRow): void;
  prepareAudit?(): (id: string, row: DecisionRow) => void;
}

export type TeamMemoryUndo = { claimed: false } | { claimed: true; state: "already_undone" | "undone" }
  | { claimed: true; state: "invalid"; error: string; status: number; stale?: true };

const TOOL = "propose_team_memory";

export function createTeamMemoryRequests(deps: TeamMemoryRequestDeps) {
  const { teamMemory, store } = deps;
  const find = (threadId: string, requestId: string) =>
    store.messagesFor(threadId).find((message) => {
      const request = message.card?.teamMemoryRequest;
      const botId = message.from?.botId ?? store.botByThread(threadId)?.id;
      return message.card?.requestId === requestId && request?.entryId === requestId && typeof request.section === "string"
        && Boolean(botId && teamMemory.matchesCard(requestId, request.section, threadId, botId));
    });

  const reconcile = (_newDecisionId?: string) => {
    let pending = 0;
    let audit = deps.audit;
    if (deps.prepareAudit) {
      try { audit = deps.prepareAudit(); }
      catch { audit = undefined; pending++; }
    }
    for (const receipt of teamMemory.reviewReceipts()) {
      if (receipt.audit && audit) {
        try {
          audit(receipt.entryId, { at: new Date(receipt.at).toISOString(), threadId: receipt.untrusted ? "" : receipt.threadId, requestId: receipt.entryId, ...(!receipt.untrusted && receipt.botId ? { botId: receipt.botId } : {}), tool: TOOL, decision: receipt.answer === "allow" ? "user-approved" : "user-denied", source: "user", ...(receipt.audit.actor ? { actor: receipt.audit.actor } : {}) });
        } catch { pending++; }
      }
      try {
        if (!receipt.threadId || (deps.threadExists && !deps.threadExists(receipt.threadId))) continue;
        const message = find(receipt.threadId, receipt.entryId);
        if (!message?.card || message.card.teamMemoryRequest?.entryId !== receipt.entryId) continue;
        if (receipt.untrusted && (message.from?.botId ?? store.botByThread(receipt.threadId)?.id) !== receipt.botId) continue;
        if (message.card.answered === receipt.answer && message.card.subtitle === receipt.summary) continue;
        store.patchMessage(receipt.threadId, message.id, { card: { ...message.card, answered: receipt.answer, subtitle: receipt.summary } });
      } catch { pending++; }
    }
    return pending;
  };

  return {
    reconcile,
    /** Throws on invalid input; a conflict with an accepted fact comes back as `error` and saves nothing. */
    submit(from: Speaker, threadId: string, inRoom: boolean, input: TeamMemoryInput, direct: DirectApply | null) {
      if (deps.requireReview) direct = null;
      const proposed = teamMemory.propose(from.section, input, { botId: from.id, botName: from.name, threadId, cardSection: deps.sectionKey(from.section), at: Date.now() });
      const entry = proposed.entry;
      let revision: string | undefined;
      if (direct) {
        try { teamMemory.resolve(from.section, entry.id, "accept"); }
        catch (error) {
          teamMemory.resolve(from.section, entry.id, "reject");
          if (error instanceof TeamMemoryConflict) return { status: 409, body: { error: error.message } };
          throw error;
        }
        revision = teamMemory.list(from.section).find((candidate) => candidate.id === entry.id)?.revision;
      }
      const summary = `${entry.kind[0].toUpperCase()}${entry.kind.slice(1)}: ${entry.name}${entry.aliases.length ? ` (also ${entry.aliases.join(", ")})` : ""} — ${entry.detail}`;
      const message = store.appendMessage(threadId, {
        role: "bot",
        kind: "options",
        ...(inRoom ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
        card: {
          title: direct ? "Remembered for the team" : "Remember this for the team?",
          subtitle: summary,
          options: direct ? [] : ["Remember", "Skip"],
          ...(direct ? { answered: "allow", autoApplied: true } : {}),
          requestId: entry.id,
          tool: TOOL,
          teamMemoryRequest: { section: deps.sectionKey(from.section), entryId: entry.id, kind: entry.kind, ...(revision ? { revision } : {}) },
        },
      });
      deps.decide({ threadId, requestId: entry.id, botId: from.id, tool: TOOL,
        decision: direct ? "auto-approved" : "card-shown", source: direct ?? "team-memory" });
      return { status: 201, body: { status: direct ? "applied" : "proposed", state: direct ? "applied" : "pending", requestId: entry.id, messageId: message.id, summary } };
    },

    /** The owner's answer to a card; null when the request is not a team memory card. */
    resolve(threadId: string, requestId: string, behavior: string): { ok: true; outcome: string; alreadySettled?: true } | null {
      const message = find(threadId, requestId);
      const request = message?.card?.teamMemoryRequest;
      if (!message?.card || !request) return null;
      const hint = teamMemory.untrustedProposal(request.entryId);
      if (hint && (hint.threadId !== threadId || (message.from?.botId ?? store.botByThread(threadId)?.id) !== hint.botId)) {
        return { ok: true, outcome: "unavailable" };
      }
      const existing = teamMemory.reviewReceipts().find((receipt) => receipt.entryId === request.entryId && receipt.threadId === threadId);
      if (existing) {
        reconcile();
        return { ok: true, outcome: existing.answer === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
      }
      const result = teamMemory.resolveProposal(request.entryId, behavior === "allow" ? "accept" : "reject", { actor: currentDecisionActor() });
      if (!result.claimed) {
        if (!message.card.answered) store.patchMessage(threadId, message.id, { card: { ...message.card, answered: "unavailable", dismissed: true } });
        return { ok: true, outcome: "unavailable" };
      }
      if (result.state === "already_settled") return { ok: true, outcome: "allowed-once", alreadySettled: true };
      reconcile(request.entryId);
      return { ok: true, outcome: result.state === "accepted" ? "allowed-once" : "rejected" };
    },

    undo(threadId: string, requestId: string): TeamMemoryUndo {
      const message = find(threadId, requestId);
      const card = message?.card;
      const request = card?.teamMemoryRequest;
      if (!message || !card || !request) return { claimed: false };
      if (card.undone) return { claimed: true, state: "already_undone" };
      if (!card.autoApplied || card.answered !== "allow" || !request.revision) {
        return { claimed: true, state: "invalid", error: "Only a change that applied on its own can be undone here.", status: 409 };
      }
      if (!teamMemory.undoAccept(request.section, request.entryId, request.revision)) {
        return { claimed: true, state: "invalid", error: UNDO_STALE, status: 409, stale: true };
      }
      store.patchMessage(threadId, message.id, { card: { ...card, undone: true } });
      return { claimed: true, state: "undone" };
    },
  };
}
