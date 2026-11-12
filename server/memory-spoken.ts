// Only an explicit remember, correct or forget sentence is a write. Ordinary chat is not.

export type SpokenMemoryCommand =
  | { action: "append"; text: string }
  | { action: "prefer"; text: string }
  | { action: "forget"; oldText: string }
  | { action: "supersede"; text: string; oldText: string };

export interface SpokenMemoryHarness {
  agentsMcp: boolean;
  workspaceFiles: boolean;
  memoryEnabled: boolean;
  writesRefused: boolean;
  personSpoke: boolean;
}

const MAX_UTTERANCE = 400;
const MAX_FACT = 300;

const POLITE_ZH = /^(?:(?:请|帮我|麻烦你?)\s*)*/u;
const REMEMBER_ZH = new RegExp(`${POLITE_ZH.source}记住(?:一下)?\\s*[:：]?\\s*(.+)$`, "u");
const FORGET_ZH = new RegExp(`${POLITE_ZH.source}(?:忘记|忘掉)(?:一下)?\\s*[:：]?\\s*(.+)$`, "u");
const CORRECT_SWAP_ZH = new RegExp(`${POLITE_ZH.source}(?:把|将)\\s*(.+?)\\s*(?:改成|改为|改正为)\\s*(.+)$`, "u");
const CORRECT_NOT_ZH = new RegExp(`${POLITE_ZH.source}改正(?:一下)?\\s*[:：]\\s*(?:不是|并非)\\s*(.+?)\\s*[,，]\\s*(?:是|改为|改成)\\s*(.+)$`, "u");
const CORRECT_ZH = new RegExp(`${POLITE_ZH.source}改正(?:一下)?\\s*[:：]?\\s*(.+?)\\s*[,，]\\s*(?:不是|并非|而非)\\s*(.+)$`, "u");
const REMEMBER_EN = /^(?:please\s+)?remember(?:\s+that|\s+this)?\s*[:,]?\s+(.+)$/i;
const FORGET_EN = /^(?:please\s+)?forget(?:\s+about|\s+that)?\s*[:,]?\s+(.+)$/i;
const CORRECT_COLON_EN = /^(?:please\s+)?correct(?:ion)?\s*:\s*(.+?),\s*not\s+(.+)$/i;
const CORRECT_NOT_EN = /^(?:please\s+)?correct(?:ion)?\s*:\s*not\s+(.+?),\s*(.+)$/i;
const CORRECT_TO_EN = /^(?:please\s+)?correct\s+(.+?)\s+to\s+(.+)$/i;
const NOT_A_REMEMBER = /^(?:when|how|why|what|who|where|if|whether)\b/i;

export function spokenMemoryHarnessApplies(input: SpokenMemoryHarness): boolean {
  return input.agentsMcp !== true
    && input.workspaceFiles === false
    && input.memoryEnabled === true
    && input.writesRefused === false
    && input.personSpoke === true;
}

function normalizeUtterance(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_UTTERANCE || /[?？]/.test(text) || /[吗呢]\s*$/u.test(text)) return null;
  return text;
}

function factOf(value: string): string | null {
  const fact = value.replace(/\s+/g, " ").trim().replace(/[.。!！]+$/u, "").trim();
  const letters = fact.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters < 2 || fact.length > MAX_FACT || fact.startsWith("了")) return null;
  return fact;
}

function sharedProfile(fact: string): boolean {
  if (/^(?:我叫|我的名字是|我的姓名是|名字是|姓名是)/u.test(fact)) return true;
  if (/^(?:my name is|i am called|i'm called)\b/i.test(fact)) return true;
  if (/时区\s*(?:是|为|:|：)/u.test(fact) || /\btime ?zone\s*(?:is|=|:)/i.test(fact)) return true;
  if (/(?:所有|每个)\s*(?:bot|机器人)/i.test(fact) || /\b(?:every bot|all (?:of )?(?:my |the )?bots)\b/i.test(fact)) return true;
  return false;
}

function remember(fact: string): SpokenMemoryCommand | null {
  const text = factOf(fact);
  if (!text || NOT_A_REMEMBER.test(text)) return null;
  return sharedProfile(text) ? { action: "prefer", text } : { action: "append", text };
}

function sides(oldText: string, text: string): SpokenMemoryCommand | null {
  const previous = factOf(oldText);
  const next = factOf(text);
  if (!previous || !next) return null;
  return { action: "supersede", oldText: previous, text: next };
}

/** The command, or null when the line is ordinary chat. */
export function parseSpokenMemory(raw: string): SpokenMemoryCommand | null {
  const text = normalizeUtterance(raw);
  if (!text) return null;
  const swapped = CORRECT_SWAP_ZH.exec(text);
  if (swapped) return sides(swapped[1]!, swapped[2]!);
  const correctedNot = CORRECT_NOT_ZH.exec(text);
  if (correctedNot) return sides(correctedNot[1]!, correctedNot[2]!);
  const corrected = CORRECT_ZH.exec(text);
  if (corrected) return sides(corrected[2]!, corrected[1]!);
  const colon = CORRECT_COLON_EN.exec(text);
  if (colon) return sides(colon[2]!, colon[1]!);
  const notFirst = CORRECT_NOT_EN.exec(text);
  if (notFirst) return sides(notFirst[1]!, notFirst[2]!);
  const to = CORRECT_TO_EN.exec(text);
  if (to) return sides(to[1]!, to[2]!);
  const remembered = REMEMBER_ZH.exec(text) ?? REMEMBER_EN.exec(text);
  if (remembered) return remember(remembered[1]!);
  const forgotten = FORGET_ZH.exec(text) ?? FORGET_EN.exec(text);
  if (forgotten) {
    const oldText = factOf(forgotten[1]!);
    return oldText ? { action: "forget", oldText } : null;
  }
  return null;
}

/** The command to pass to botMemoryUpdate, or null when this turn must not write it. */
export function spokenMemoryToApply(input: SpokenMemoryHarness, text: string): SpokenMemoryCommand | null {
  if (!spokenMemoryHarnessApplies(input)) return null;
  return parseSpokenMemory(text);
}
