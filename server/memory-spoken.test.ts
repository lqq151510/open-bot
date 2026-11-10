import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { createAboutMe } from "./about-me.ts";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { botMemoryUpdate } from "./memory-forget.ts";
import {
  parseSpokenMemory,
  spokenMemoryHarnessApplies,
  spokenMemoryToApply,
  type SpokenMemoryHarness,
} from "./memory-spoken.ts";
import { readMemoryFile, writeMemoryFile } from "./workspace.ts";

const open: SpokenMemoryHarness = {
  agentsMcp: false,
  workspaceFiles: false,
  memoryEnabled: true,
  writesRefused: false,
  personSpoke: true,
};

describe("parseSpokenMemory", () => {
  it("accepts an explicit remember, correct or forget in either language", () => {
    expect(parseSpokenMemory("记住我喜欢早上喝茶")).toEqual({ action: "append", text: "我喜欢早上喝茶" });
    expect(parseSpokenMemory("请记住：我喜欢茶")).toEqual({ action: "append", text: "我喜欢茶" });
    expect(parseSpokenMemory("Remember: I prefer short answers")).toEqual({ action: "append", text: "I prefer short answers" });
    expect(parseSpokenMemory("Please remember that I like tea")).toEqual({ action: "append", text: "I like tea" });
    expect(parseSpokenMemory("记住我叫泽宝")).toEqual({ action: "prefer", text: "我叫泽宝" });
    expect(parseSpokenMemory("Remember my name is Ada")).toEqual({ action: "prefer", text: "my name is Ada" });
    expect(parseSpokenMemory("记住我的时区是上海")).toEqual({ action: "prefer", text: "我的时区是上海" });
    expect(parseSpokenMemory("Remember that every bot should keep replies short")).toEqual({
      action: "prefer",
      text: "every bot should keep replies short",
    });
    expect(parseSpokenMemory("忘记短回复")).toEqual({ action: "forget", oldText: "短回复" });
    expect(parseSpokenMemory("Please forget short answers")).toEqual({ action: "forget", oldText: "short answers" });
    expect(parseSpokenMemory("改正：我住在上海，不是北京")).toEqual({ action: "supersede", oldText: "北京", text: "我住在上海" });
    expect(parseSpokenMemory("把北京改成上海")).toEqual({ action: "supersede", oldText: "北京", text: "上海" });
    expect(parseSpokenMemory("correct: I live in Shanghai, not Beijing")).toEqual({
      action: "supersede",
      oldText: "Beijing",
      text: "I live in Shanghai",
    });
  });

  it("leaves ordinary chat alone", () => {
    for (const line of [
      "今天天气不错",
      "别忘记带伞",
      "不要忘记带伞",
      "Don't forget the milk",
      "What should I remember for the exam?",
      "记住了吗",
      "Remember when we met",
      "I remember the launch",
      "Can you remember my favorite color?",
      "你还记得我喜欢茶吗",
    ]) {
      expect(parseSpokenMemory(line), line).toBeNull();
    }
  });
});

describe("spoken memory harness", () => {
  const bot = "memory-spoken-harness";

  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  function apply(text: string, flags: SpokenMemoryHarness = open) {
    const command = spokenMemoryToApply(flags, text);
    if (!command) return { called: false as const, result: null };
    const profile = { aboutMe: "" };
    const aboutMe = createAboutMe({
      read: () => profile.aboutMe,
      write: (next) => { profile.aboutMe = next; },
      changed: () => undefined,
      today: () => "2026-11-10",
    });
    return {
      called: true as const,
      result: botMemoryUpdate(bot, command, {
        source: "spoken",
        aboutMe,
        prefer: { save: (line) => aboutMe.learn({ botId: bot, botName: "Scout" }, [line]) },
      }),
    };
  }

  it("calls botMemoryUpdate for a bare engine and not when agents tools are mounted", () => {
    writeMemoryFile(bot, "- 2026-10-01 · 北京\n");
    const remembered = apply("记住我喜欢茶");
    expect(remembered.called).toBe(true);
    expect(remembered.result).toMatchObject({ ok: true });
    expect(readMemoryFile(bot).text).toContain("我喜欢茶");

    const corrected = apply("改正：我住在上海，不是北京");
    expect(corrected.called).toBe(true);
    expect(readMemoryFile(bot).text).toContain("~~北京~~");
    expect(readMemoryFile(bot).text).toContain("我住在上海");

    const forgotten = apply("Please forget short answers");
    expect(forgotten.called).toBe(true);

    const beforeMounted = readMemoryFile(bot).text;
    const mounted = apply("记住我喜欢茶", { ...open, agentsMcp: true });
    expect(mounted.called).toBe(false);
    expect(readMemoryFile(bot).text).toBe(beforeMounted);
    expect(spokenMemoryHarnessApplies({ ...open, workspaceFiles: true })).toBe(false);
    expect(spokenMemoryHarnessApplies({ ...open, memoryEnabled: false })).toBe(false);
    expect(spokenMemoryHarnessApplies({ ...open, writesRefused: true })).toBe(false);
    expect(spokenMemoryHarnessApplies({ ...open, personSpoke: false })).toBe(false);
    expect(spokenMemoryHarnessApplies(open)).toBe(true);
    expect(apply("今天天气不错").called).toBe(false);
  });
});
