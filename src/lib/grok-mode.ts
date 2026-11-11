// Grok Bot mode: Normal vs Fun Mode, plus Think Mode (Reasoning toggle)

export type GrokPersonaMode = "normal" | "fun";

const GROK_MODE_STORAGE_KEY = "omb-grok-mode";
const GROK_THINK_STORAGE_KEY = "omb-grok-think";

export function readGrokPersonaMode(): GrokPersonaMode {
  try {
    if (typeof localStorage === "undefined") return "normal";
    const stored = localStorage.getItem(GROK_MODE_STORAGE_KEY);
    return stored === "fun" ? "fun" : "normal";
  } catch {
    return "normal";
  }
}

export function writeGrokPersonaMode(mode: GrokPersonaMode): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GROK_MODE_STORAGE_KEY, mode);
    }
  } catch {}
}

export function readGrokThinkMode(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(GROK_THINK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeGrokThinkMode(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GROK_THINK_STORAGE_KEY, enabled ? "true" : "false");
    }
  } catch {}
}

export const GROK_FUN_INSTRUCTION =
  "[Mode: Grok Fun Mode. Answer with a witty, sharp, slightly rebellious and humorous edge (Hitchhiker's Guide to the Galaxy style), while remaining deeply insightful and accurate.]";

export const GROK_THINK_INSTRUCTION =
  "[Thinking: Please perform detailed step-by-step reasoning inside <think>...</think> tags before presenting your final response.]";

const GROK_MODE_DIRECTIVES = [GROK_FUN_INSTRUCTION, GROK_THINK_INSTRUCTION];

function withoutLeadingDirective(text: string): string | undefined {
  const body = text.trimStart();
  for (const directive of GROK_MODE_DIRECTIVES) {
    if (!body.startsWith(directive)) continue;
    let rest = body.slice(directive.length);
    if (rest.startsWith("\n\n")) rest = rest.slice(2);
    else if (rest.startsWith(" ")) rest = rest.slice(1);
    return rest;
  }
  return undefined;
}

export function stripGrokModeDirectives(text: string): string {
  let rest = text;
  for (;;) {
    const next = withoutLeadingDirective(rest);
    if (next === undefined) return rest;
    rest = next;
  }
}

export function augmentPromptWithGrokMode(text: string, mode: GrokPersonaMode): string {
  if (mode !== "fun") return text;
  return `${GROK_FUN_INSTRUCTION}\n\n${stripGrokModeDirectives(text)}`;
}
