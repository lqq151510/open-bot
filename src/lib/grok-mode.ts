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

/**
 * Augments the outgoing user prompt with Grok's persona or thinking directives if enabled.
 */
export function augmentPromptWithGrokMode(
  text: string,
  mode: GrokPersonaMode,
  think: boolean,
): string {
  const directives: string[] = [];
  if (mode === "fun") {
    directives.push(GROK_FUN_INSTRUCTION);
  }
  if (think) {
    directives.push(GROK_THINK_INSTRUCTION);
  }
  if (directives.length === 0) return text;

  return `${directives.join(" ")}\n\n${text}`;
}
