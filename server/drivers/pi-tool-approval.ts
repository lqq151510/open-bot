import { MAX_QUESTION_TEXT, parseAskQuestions, parseChoices, questionAnswersByQuestion } from "../../shared/ask-question.ts";
import { newId, type RuntimeEvent, type SendTurnInput } from "../contracts.ts";
import { redactSecretsInText } from "../redact.ts";
import { firstToolRequiringApproval, PI_TOOL_REVIEW_TITLE } from "./tool-rule-approval.ts";

interface PiApprovalFrame { method?: string; id?: string; options?: unknown[]; title?: string; message?: unknown }
type PiDecision = { behavior: "allow" | "deny" | "answer"; message?: string };
type EventBase = Pick<RuntimeEvent, "eventId" | "provider" | "threadId" | "turnId" | "createdAt">;
interface PiReview { tool: string; alias?: string; command?: string; summary: string; ask: boolean; localComputer?: boolean }

interface PiApprovalContext {
  turn: SendTurnInput;
  settled(): boolean;
  flushAssistantText(): void;
  pending: Map<string, (decision: PiDecision) => void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  base(): EventBase;
  send(message: Record<string, unknown>): void;
  emit(event: RuntimeEvent): void;
}

function parseReview(message: unknown): PiReview | null {
  if (typeof message !== "string" || message.length > 256_000) return null;
  try {
    const value = JSON.parse(message) as Partial<PiReview> | null;
    if (!value || typeof value.tool !== "string" || !value.tool || value.tool.length > 200
      || typeof value.summary !== "string" || typeof value.ask !== "boolean"
      || (value.command !== undefined && typeof value.command !== "string")
      || (value.alias !== undefined && (typeof value.alias !== "string" || value.alias.length > 200))) return null;
    return { tool: value.tool, alias: value.alias, command: value.command, summary: value.summary, ask: value.ask, localComputer: value.localComputer === true };
  } catch {
    return null;
  }
}

function openApproval(ctx: PiApprovalContext, frame: PiApprovalFrame, review?: PiReview, alwaysAskRequired?: true): void {
  ctx.flushAssistantText();
  const requestId = frame.id ?? newId();
  const isSelect = frame.method === "select";
  const isQuestion = isSelect || frame.method === "input";
  const options = isSelect && Array.isArray(frame.options) ? frame.options.filter((value): value is string => typeof value === "string") : [];
  const summary = redactSecretsInText(String(review?.summary || frame.title || (isQuestion ? "pi has a question" : "pi wants confirmation")))
    .slice(0, isQuestion ? MAX_QUESTION_TEXT : 200);
  const question = isSelect ? parseAskQuestions({ questions: [{ question: summary, options }] })?.[0] : undefined;
  const choices = question?.options.length ? question.options.map(option => option.label) : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply = (answer: Record<string, unknown>) => ctx.send({ type: "extension_ui_response", id: requestId, ...answer });
  ctx.pending.set(requestId, (decision) => {
    if (timer) {
      clearTimeout(timer);
      ctx.timers.delete(timer);
    }
    if (decision.behavior === "deny") reply({ cancelled: true });
    else if (isQuestion) {
      const value = question ? questionAnswersByQuestion(decision.message ?? "", [question])[question.question] ?? decision.message ?? "" : decision.message ?? "";
      const matched = options.filter(option => parseChoices([option], 1)?.[0] === value);
      reply(matched.length > 1 ? { cancelled: true } : { value: matched[0] ?? value });
    } else reply({ confirmed: true });
  });
  if (!isQuestion) {
    timer = setTimeout(() => {
      if (timer) ctx.timers.delete(timer);
      if (!ctx.pending.delete(requestId)) return;
      reply({ cancelled: true });
      ctx.emit({ ...ctx.base(), requestId, type: "request.resolved", behavior: "deny", source: "timeout" });
    }, 15 * 60_000);
    ctx.timers.add(timer);
    timer.unref?.();
  }
  ctx.emit({
    ...ctx.base(), requestId, type: "request.opened", requestType: isQuestion ? "question" : "permission",
    tool: review?.tool ?? String(frame.title ?? "pi"), summary,
    ...(review?.localComputer ? { approvalScope: "local-computer" } : {}),
    ...(alwaysAskRequired ? { alwaysAskRequired: true } : {}),
    ...(choices ? { choices } : {}), ...(question ? { questions: [question] } : {}),
  });
}

export function handlePiExtensionApproval(ctx: PiApprovalContext, frame: PiApprovalFrame): void {
  if (frame.method !== "select" && frame.method !== "confirm" && frame.method !== "input") return;
  if (frame.method !== "confirm" || frame.title !== PI_TOOL_REVIEW_TITLE) {
    openApproval(ctx, frame);
    return;
  }
  const review = parseReview(frame.message);
  if (!review || !frame.id) {
    ctx.send({ type: "extension_ui_response", id: frame.id, cancelled: true });
    return;
  }
  void firstToolRequiringApproval(ctx.turn, { tool: review.tool, command: review.command }, review.alias).then(required => {
    if (ctx.settled()) return;
    if (required || review.ask) openApproval(ctx, frame, { ...review, tool: required ?? review.tool }, required ? true : undefined);
    else ctx.send({ type: "extension_ui_response", id: frame.id, confirmed: true });
  });
}
