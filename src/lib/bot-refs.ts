export interface BotRefCandidate {
  id: string;
  name: string;
  color?: string;
}

export interface BotRefSpan {
  text: string;
  bot?: BotRefCandidate;
}

export const BOT_EMOJI_PATTERN = /[🟣🔵🟢🟡🟠🔴⚫⚪🟤]/u;

const OPAQUE = new Set([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "html",
  "mention",
  "code",
  "inlineCode",
]);

export const BOT_REF_NODE = "botRef";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveBotRefs(
  text: string,
  bots: readonly BotRefCandidate[],
): BotRefSpan[] {
  if (!bots.length || !BOT_EMOJI_PATTERN.test(text)) {
    return [{ text }];
  }

  const sorted = [...bots]
    .filter((b) => b.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  if (!sorted.length) return [{ text }];

  const namePattern = sorted.map((b) => escapeRegExp(b.name)).join("|");
  const regex = new RegExp(`([🟣🔵🟢🟡🟠🔴⚫⚪🟤])\\s*(${namePattern})`, "gu");

  const spans: BotRefSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchLength = match[0].length;
    const botName = match[2];

    const foundBot = sorted.find((b) => b.name.toLowerCase() === botName.toLowerCase());
    if (!foundBot) continue;

    if (matchIndex > lastIndex) {
      spans.push({ text: text.slice(lastIndex, matchIndex) });
    }

    spans.push({
      text: botName,
      bot: foundBot,
    });

    lastIndex = matchIndex + matchLength;
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex) });
  }

  return spans.length > 0 ? spans : [{ text }];
}

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
};

function botNode(text: string, bot: BotRefCandidate): MdNode {
  return {
    type: BOT_REF_NODE,
    data: {
      hName: "span",
      hProperties: {
        "data-bot-chip": bot.id,
        "data-bot-name": bot.name,
      },
    },
    children: [{ type: "text", value: text }],
  };
}

export function remarkBotRefs(bots: readonly BotRefCandidate[]) {
  return () => (tree: MdNode) => {
    if (!bots.length) return;
    const visit = (node: MdNode) => {
      if (!node.children || OPAQUE.has(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          return [child];
        }
        const spans = resolveBotRefs(child.value, bots);
        if (!spans.some((span) => span.bot)) return [child];
        return spans.map((span) => (span.bot ? botNode(span.text, span.bot) : { type: "text", value: span.text }));
      });
    };
    visit(tree);
  };
}
