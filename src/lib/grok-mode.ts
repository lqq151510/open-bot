import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import type { EffortLevel } from "../../shared/wire";
import { utf8Bytes } from "./soul";

const FUN_START = "<!-- grok-fun -->";
const FUN_END = "<!-- /grok-fun -->";
const FUN_BODY = "Answer with a witty, sharp, slightly rebellious and humorous edge, and stay accurate.";

export const GROK_FUN_BLOCK = `${FUN_START}\n${FUN_BODY}\n${FUN_END}`;

export function soulHasGrokFun(soul: string): boolean {
  const start = soul.indexOf(FUN_START);
  if (start < 0) return false;
  return soul.indexOf(FUN_END, start + FUN_START.length) >= 0;
}

function withoutGrokFun(soul: string): string {
  const start = soul.indexOf(FUN_START);
  if (start < 0) return soul;
  const end = soul.indexOf(FUN_END, start + FUN_START.length);
  if (end < 0) return soul;
  const before = soul.slice(0, start).replace(/\n+$/u, "");
  const after = soul.slice(end + FUN_END.length).replace(/^\n+/u, "");
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`;
}

export function soulWithGrokFun(soul: string, on: boolean, limit: number = BOT_PROFILE_LIMITS.soul): string | null {
  if (!on) return withoutGrokFun(soul);
  if (soulHasGrokFun(soul)) return soul;
  const base = soul.replace(/\s+$/u, "");
  const next = base ? `${base}\n\n${GROK_FUN_BLOCK}` : GROK_FUN_BLOCK;
  return utf8Bytes(next) > limit ? null : next;
}

export interface GrokComposerModel {
  show: boolean;
  fun: boolean;
  showThink: boolean;
  think?: boolean;
  thinkDisabled: boolean;
}

export function grokComposerModel(input: {
  enabled: boolean;
  soul: string;
  driverKind?: string;
  effortLevels?: readonly string[];
  effort?: string;
  busy: boolean;
}): GrokComposerModel {
  const show = input.enabled && input.driverKind === "grokAgent";
  const showThink = show && input.effortLevels?.includes("high") === true;
  return {
    show,
    fun: soulHasGrokFun(input.soul),
    showThink,
    think: showThink ? input.effort === "high" : undefined,
    thinkDisabled: input.busy,
  };
}

export type GrokFunToggle =
  | { kind: "unchanged" }
  | { kind: "tooLong" }
  | { kind: "update"; soul: string };

export function grokFunToggle(soul: string, limit?: number): GrokFunToggle {
  const next = soulWithGrokFun(soul, !soulHasGrokFun(soul), limit);
  if (next === null) return { kind: "tooLong" };
  if (next === soul) return { kind: "unchanged" };
  return { kind: "update", soul: next };
}

export function grokThinkSelection<Selection extends { effort?: EffortLevel }>(selection: Selection, busy: boolean): Selection | null {
  if (busy) return null;
  const next = { ...selection };
  if (next.effort === "high") delete next.effort;
  else next.effort = "high";
  return next;
}
