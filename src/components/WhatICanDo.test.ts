// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

import { WhatICanDo } from "./WhatICanDo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (extra: Partial<Bot> = {}): Pick<Bot, "description" | "defaultBot" | "chiefOfStaff"> => ({
  description: "",
  ...extra,
});

let host: HTMLDivElement;
let root: Root;

const show = async (target: Pick<Bot, "description" | "defaultBot" | "chiefOfStaff">, engineName: string | null = null, teamName?: string) => {
  await act(async () => { root.render(createElement(WhatICanDo, { bot: target, engineName, teamName })); });
};

const capsule = () => host.querySelector<HTMLButtonElement>("[data-what-i-can-do]");
const panel = () => host.querySelector("[data-what-i-can-do-panel]");

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setLocale("en");
});

describe("What I can do", () => {
  it("opens this helper's existing intro, closes on a second click, and closes on Escape", async () => {
    await show(bot({ defaultBot: {}, description: "Keeps an eye on the day." }), "Claude");
    const button = capsule();
    expect(button?.textContent).toBe("What I can do");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();

    await act(async () => { button!.click(); });
    expect(capsule()?.getAttribute("aria-expanded")).toBe("true");
    expect(panel()?.textContent).toContain("Keeps an eye on the day.");
    expect(panel()?.textContent).toContain("Ask me how to do anything here. I can set up bots, apps and routines with you, and keep an eye on your day.");
    expect(panel()?.textContent).toContain("What are my bots up to?");
    expect(panel()?.textContent).toContain("Thinking with Claude.");
    expect(panel()?.textContent).toContain("I can do more than just chat");
    expect(panel()?.textContent).toContain("Research topics, follow AI news, and compare tools and plans.");

    await act(async () => { capsule()!.click(); });
    expect(panel()).toBeNull();

    await act(async () => { capsule()!.click(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(panel()).toBeNull();
    expect(capsule()?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { capsule()!.click(); });
    expect(panel()).not.toBeNull();
    await act(async () => { document.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(panel()).toBeNull();
    expect(capsule()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses the chief and team lines that the welcome already has", async () => {
    await show(bot({ defaultBot: {}, chiefOfStaff: true }), null, "Northwind");
    await act(async () => { capsule()!.click(); });
    expect(panel()?.textContent).toContain("I'm here to be your Chief of Staff.");
    expect(panel()?.textContent).not.toContain("keep an eye on your day");
  });

  it("uses the team member line when this helper belongs to a team", async () => {
    await show(bot({ defaultBot: {} }), null, "Northwind");
    await act(async () => { capsule()!.click(); });
    expect(panel()?.textContent).toContain("I can set up bots, apps and routines with you.");
    expect(panel()?.textContent).not.toContain("keep an eye on your day");
  });

  it("shows a specialist's own description and engine, not the helper's asks or capabilities", async () => {
    await show(bot({ description: "Watch the inbox." }), "Codex");
    await act(async () => { capsule()!.click(); });
    expect(panel()?.textContent).toContain("Watch the inbox.");
    expect(panel()?.textContent).toContain("Thinking with Codex.");
    expect(panel()?.textContent).not.toContain("What are my bots up to?");
    expect(panel()?.textContent).not.toContain("Research topics");
    expect(panel()?.textContent).not.toContain("This bot has not described what it can do yet.");
  });

  it("says when a bot has no description and no engine", async () => {
    await show(bot());
    await act(async () => { capsule()!.click(); });
    expect(panel()?.textContent).toContain("This bot has not described what it can do yet.");
    expect(panel()?.textContent).not.toContain("Thinking with");
  });

  it("uses the Chinese label and capability list for default bot", async () => {
    await loadLocale("zh");
    await show(bot({ defaultBot: {} }));
    expect(capsule()?.textContent).toBe("你会什么");
    await act(async () => { capsule()!.click(); });
    expect(panel()?.textContent).toContain("我不只会聊天，也能帮你实际做事：");
    expect(panel()?.textContent).toContain("查资料、追 AI 动态、比较工具和套餐。");
    expect(panel()?.textContent).toContain("写文案、翻译、整理文档、表格和幻灯片。");
    expect(panel()?.textContent).toContain("写代码、排查报错、处理文件。");
    expect(panel()?.textContent).toContain("用我的电脑操作网页、安装软件。");
    expect(panel()?.textContent).toContain("整理邮件、起草回复、设置定时提醒。");
    expect(panel()?.textContent).toContain("你直接说想完成什么就行；发消息、付款这类操作会先让你确认。");
  });
});
