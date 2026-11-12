import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TeamsConversationStore } from "./conversation-store.ts";

describe("Teams conversation storage", () => {
  it("keeps distinct member conversations and immutable reply targets across restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "openbot-teams-map-"));
    const path = join(dir, "map.sqlite");
    const key = { appId: "app", tenantId: "tenant", botId: "bot", botGeneration: "generation", memberId: "member1", conversationId: "conversation" };
    const target = { ...key, memberGeneration: "member1", activityId: "activity", serviceUrl: "https://example.test/" };
    const sendId = "a".repeat(43);
    const identity = { appId: "app", tenantId: "tenant", objectId: "object" };
    let store = new TeamsConversationStore(path);
    try {
      expect(store.bindThread(key, "thread1")).toBe(true);
      expect(store.bindThread(key, "other-thread")).toBe(false);
      expect(store.threadFor({ ...key, memberId: "member2" })).toBeNull();
      expect(store.bindThread({ ...key, memberId: "member2" }, "thread1")).toBe(false);
      expect(store.bindReply(sendId, target, identity, "link-generation")).toBe(true);
      expect(store.bindReply(sendId, { ...target, conversationId: "other" }, identity, "link-generation")).toBe(false);
      store.close();
      store = new TeamsConversationStore(path);
      expect(store.threadFor(key)).toBe("thread1");
      expect(store.replyFor(sendId)).toEqual(target);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
