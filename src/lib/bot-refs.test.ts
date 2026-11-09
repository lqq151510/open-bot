import { describe, expect, it } from "vitest";
import { remarkBotRefs, resolveBotRefs, type BotRefCandidate } from "./bot-refs";

describe("resolveBotRefs", () => {
  const bots: BotRefCandidate[] = [
    { id: "openai-intel", name: "OpenAI 情报", color: "purple" },
    { id: "news", name: "AI 新闻", color: "green" },
  ];

  it("resolves purple circle followed by bot name into bot span", () => {
    const text = "点这里就能打开: 🟣 OpenAI 情报。";
    const spans = resolveBotRefs(text, bots);
    expect(spans).toEqual([
      { text: "点这里就能打开: " },
      { text: "OpenAI 情报", bot: bots[0] },
      { text: "。" },
    ]);
  });

  it("handles no space between emoji and bot name", () => {
    const text = "已创建 🟣OpenAI 情报，专门收集";
    const spans = resolveBotRefs(text, bots);
    expect(spans).toEqual([
      { text: "已创建 " },
      { text: "OpenAI 情报", bot: bots[0] },
      { text: "，专门收集" },
    ]);
  });

  it("handles different circle emojis", () => {
    const text = "关注 🟢 AI 新闻 的动态";
    const spans = resolveBotRefs(text, bots);
    expect(spans).toEqual([
      { text: "关注 " },
      { text: "AI 新闻", bot: bots[1] },
      { text: " 的动态" },
    ]);
  });

  it("leaves text alone when no circle emoji matches", () => {
    const text = "我来创建一个专门收集 OpenAI 情报的 Bot";
    const spans = resolveBotRefs(text, bots);
    expect(spans).toEqual([{ text }]);
  });
});

describe("remarkBotRefs", () => {
  const bots: BotRefCandidate[] = [{ id: "openai-intel", name: "OpenAI 情报", color: "purple" }];

  it("transforms text node into botRef node", () => {
    const tree = {
      type: "paragraph",
      children: [{ type: "text", value: "点这里就能打开: 🟣 OpenAI 情报。" }],
    };
    remarkBotRefs(bots)()(tree);
    expect(tree.children).toHaveLength(3);
    expect(tree.children[1]).toMatchObject({
      type: "botRef",
      data: {
        hName: "span",
        hProperties: {
          "data-bot-chip": "openai-intel",
          "data-bot-name": "OpenAI 情报",
        },
      },
      children: [{ type: "text", value: "OpenAI 情报" }],
    });
  });
});
