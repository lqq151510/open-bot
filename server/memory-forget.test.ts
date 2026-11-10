import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createAboutMe, withoutMentionedLines } from "./about-me.ts";
import { DATA_DIR } from "./config.ts";
import { passageMatcher } from "./memory-entries.ts";
import { botMemoryUpdate, ownersOwnAsk, withoutMentions } from "./memory-forget.ts";
import { parseSpokenMemory } from "./memory-spoken.ts";
import { closeMessageDb } from "./message-db.ts";
import { readMemoryFile, updateMemory, workspaceDir, writeMemoryFile } from "./workspace.ts";

const mentions = (passage: string) => passageMatcher(passage)!;

describe("passageMatcher", () => {
  it("matches whole words however the note was typed, and refuses a passage too short to name anything", () => {
    expect(mentions("IST")("The person is in India (IST)")).toBe(true);
    expect(mentions("IST")("The person sees a dentist on Fridays")).toBe(false);
    expect(mentions("short answers")("The person prefers SHORT   answers.")).toBe(true);
    expect(mentions("I'm vegetarian")("I’m vegetarian")).toBe(true);
    expect(passageMatcher("ab")).toBeNull();
    expect(passageMatcher(" - ")).toBeNull();
  });
});

describe("withoutMentions", () => {
  it("drops a dated entry by its fact, never by the chat it came from", () => {
    const notes = [
      '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person is in India (IST)',
      '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person prefers short answers',
      "- 2026-10-01 · ~~The person likes long answers~~ · superseded 2026-10-27",
    ].join("\n");
    expect(withoutMentions(notes, mentions("short answers"))).toEqual({
      text: '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person is in India (IST)\n- 2026-10-01 · ~~The person likes long answers~~ · superseded 2026-10-27',
      removed: ["The person prefers short answers"],
    });
    expect(withoutMentions(notes, mentions("long answers")).removed).toEqual(["The person likes long answers"]);
  });

  it("keeps a topic's frontmatter and headings, and drops a hand-written line that mentions it", () => {
    const topic = "---\ntitle: work\naliases: [IST, hours]\n---\n# Hours\n- Works in IST, 10 to 7\n- Ships on Thursdays\n";
    expect(withoutMentions(topic, mentions("IST"))).toEqual({
      text: "---\ntitle: work\naliases: [IST, hours]\n---\n# Hours\n- Ships on Thursdays\n",
      removed: ["Works in IST, 10 to 7"],
    });
  });
});

describe("withoutMentionedLines", () => {
  it("drops About me lines, learned or written, by their fact and never by the bot that learned them", () => {
    const aboutMe = "I live in Pune.\nI like short answers.\n- 2026-10-27 · learned by Short Answers Bot · The person is in India (IST)\n- 2026-10-27 · learned by Scout · The person prefers short answers";
    expect(withoutMentionedLines(aboutMe, mentions("short answers"))).toEqual({
      text: "I live in Pune.\n- 2026-10-27 · learned by Short Answers Bot · The person is in India (IST)",
      removed: ["I like short answers.", "The person prefers short answers"],
    });
  });
});

describe("ownersOwnAsk", () => {
  it("is true only when the person's own words started the turn", () => {
    expect(ownersOwnAsk([{ role: "user", kind: "text" }, { role: "bot", kind: "text" }])).toBe(true);
    expect(ownersOwnAsk([{ role: "user", kind: "text", sender: { name: "Asha" } }])).toBe(false);
    expect(ownersOwnAsk([{ role: "user", kind: "text", peerAsk: true }])).toBe(false);
    expect(ownersOwnAsk([{ role: "bot", kind: "text" }])).toBe(false);
  });
});

const SPOKEN_BOT = "memory-forget-spoken";

describe("spoken remember, correct and forget", () => {
  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  function openAbout() {
    const profile = { aboutMe: "I live in Pune." };
    const aboutMe = createAboutMe({
      read: () => profile.aboutMe,
      write: (text) => { profile.aboutMe = text; },
      changed: () => undefined,
      today: () => "2026-11-10",
    });
    const prefer = { save: (text: string) => aboutMe.learn({ botId: SPOKEN_BOT, botName: "Scout" }, [text]) };
    const write = (body: { action?: unknown; text?: unknown; oldText?: unknown }) =>
      botMemoryUpdate(SPOKEN_BOT, body, { source: "spoken", aboutMe, prefer });
    return { profile, write };
  }

  it("forgets the passage from this bot's notes and About me", () => {
    const { profile, write } = openAbout();
    writeMemoryFile(SPOKEN_BOT, "- The person prefers short answers\n- The person is in India (IST)\n");
    profile.aboutMe = "I live in Pune.\nThe person prefers short answers";
    const command = parseSpokenMemory("Please forget short answers");
    expect(command).toEqual({ action: "forget", oldText: "short answers" });
    expect(write(command!)).toMatchObject({ ok: true });
    expect(readMemoryFile(SPOKEN_BOT).text).not.toContain("short answers");
    expect(readMemoryFile(SPOKEN_BOT).text).toContain("India (IST)");
    expect(profile.aboutMe).toBe("I live in Pune.");
  });

  it("saves a spoken name only in About me", () => {
    const { profile, write } = openAbout();
    const command = parseSpokenMemory("记住我叫泽宝");
    expect(command).toEqual({ action: "prefer", text: "我叫泽宝" });
    expect(write(command!)).toMatchObject({ ok: true, preference: "saved" });
    expect(profile.aboutMe).toContain("我叫泽宝");
    expect(readMemoryFile(SPOKEN_BOT).text).not.toContain("泽宝");
  });

  it("corrects by striking the old line and writing the new one", () => {
    const { write } = openAbout();
    writeMemoryFile(SPOKEN_BOT, "- 2026-10-01 · 北京\n");
    const command = parseSpokenMemory("改正：我住在上海，不是北京");
    expect(command).toEqual({ action: "supersede", oldText: "北京", text: "我住在上海" });
    expect(write(command!).ok).toBe(true);
    const text = readMemoryFile(SPOKEN_BOT).text;
    expect(text).toContain("~~北京~~");
    expect(text).toContain("superseded");
    expect(text).toContain("我住在上海");
  });

  it("refuses a password, card, phone or email and leaves the file untouched", () => {
    const { profile, write } = openAbout();
    writeMemoryFile(SPOKEN_BOT, "- keep this\n");
    const before = readMemoryFile(SPOKEN_BOT).text;
    for (const text of [
      "Email ada@example.com",
      "mailbox ada@localhost",
      "电话 13800138000",
      "Call +14155552671",
      "phone (415) 555-2671",
      "card 4111111111111111",
      "card 4111 1111 1111 1111",
      "password is hunter2",
      "密码是 hunter2",
    ]) {
      expect(write({ action: "append", text }), text).toMatchObject({ ok: false, code: "invalid" });
      expect(updateMemory(SPOKEN_BOT, { action: "append", text }).ok, text).toBe(false);
      expect(readMemoryFile(SPOKEN_BOT).text, text).toBe(before);
    }
    expect(write({ action: "prefer", text: "Email ada@example.com" })).toMatchObject({ ok: false, code: "invalid" });
    expect(profile.aboutMe).toBe("I live in Pune.");
    expect(write({ action: "forget", oldText: "ada@example.com" })).toMatchObject({ ok: false, code: "invalid" });
    expect(existsSync(join(DATA_DIR, "profile-learned.json"))).toBe(false);
    const fresh = "memory-secret-fresh";
    expect(updateMemory(fresh, { action: "append", text: "ada@example.com" }).ok).toBe(false);
    expect(existsSync(join(workspaceDir(fresh), "MEMORY.md"))).toBe(false);
    expect(updateMemory(SPOKEN_BOT, { action: "append", text: "The user likes answering email in the morning" }).ok).toBe(true);
    expect(updateMemory(SPOKEN_BOT, { action: "append", text: "The password is required for the admin site" }).ok).toBe(true);
    expect(updateMemory(SPOKEN_BOT, { action: "append", text: "The build number is 20261110142600" }).ok).toBe(true);
    expect(readMemoryFile(SPOKEN_BOT).text).toContain("answering email in the morning");
    expect(readMemoryFile(SPOKEN_BOT).text).not.toContain("ada@example.com");
  });

  it("refuses a screen dump and still stores a fact that only mentions a screen", () => {
    writeMemoryFile(SPOKEN_BOT, "- keep this\n");
    const before = readMemoryFile(SPOKEN_BOT).text;
    for (const text of [
      `data:image/png;base64,${"A".repeat(48)}`,
      `iVBORw0KGgo${"A".repeat(24)}`,
      "AXWindow Untitled AXButton Save",
      "element_token s1-e2",
      "The screenshot shows the invoice table and a Pay button.",
      "Done. The screenshot shows the form submitted.",
      "屏幕显示余额是 12 元",
      "Clicked (120, 80) (400, 300) (12, 40) and stopped.",
    ]) {
      expect(updateMemory(SPOKEN_BOT, { action: "append", text }).ok, text).toBe(false);
      expect(readMemoryFile(SPOKEN_BOT).text, text).toBe(before);
    }
    expect(updateMemory(SPOKEN_BOT, { action: "append", text: "The person wants the login screen to stay in Chinese." }).ok).toBe(true);
    expect(updateMemory(SPOKEN_BOT, { action: "append", text: "The deploy finished." }).ok).toBe(true);
    expect(readMemoryFile(SPOKEN_BOT).text).toContain("login screen");
    expect(readMemoryFile(SPOKEN_BOT).text).not.toContain("invoice table");
  });
});
