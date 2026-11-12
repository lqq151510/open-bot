import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamsActivityInbox } from "./activity-inbox.ts";

const key = { appId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", conversationId: "conversation-1", activityId: "activity-1" };
const body = new TextEncoder().encode('{"text":"private message"}');
const encoder = new TextEncoder();
const sign = (activity: typeof key, bytes: Uint8Array, deadline: number) => {
  const signature = createHmac("sha256", "fixture-only-key").update(JSON.stringify([activity, Buffer.from(bytes).toString("base64"), deadline])).digest("hex");
  return encoder.encode(JSON.stringify({ deadline, signature }));
};
const verify = (activity: typeof key, bytes: Uint8Array, proof: Uint8Array): number | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(proof)) as { deadline: number; signature: string };
    const expected = JSON.parse(new TextDecoder().decode(sign(activity, bytes, parsed.deadline))) as { signature: string };
    const actualBytes = Buffer.from(parsed.signature, "hex"), expectedBytes = Buffer.from(expected.signature, "hex");
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? parsed.deadline : null;
  } catch { return null; }
};
let dir: string;
let path: string;
let now: number;
let inbox: TeamsActivityInbox;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "openbot-teams-inbox-")); path = join(dir, "inbox.db"); now = 100_000; inbox = new TeamsActivityInbox(path, () => now, 2); });
afterEach(() => { inbox.close(); rmSync(dir, { recursive: true, force: true }); });

describe("Teams activity inbox", () => {
  it("deduplicates concurrently and across restarts, without storing message text or lease secrets", () => {
    const first = inbox.claim(key, body);
    expect(first.state).toBe("claimed");
    if (first.state !== "claimed") throw new Error("claim failed");
    const second = new TeamsActivityInbox(path, () => now, 2);
    try { expect(second.claim(key, body)).toEqual({ state: "busy", sendId: first.sendId }); } finally { second.close(); }
    const read = new DatabaseSync(path, { readOnly: true });
    const stored = JSON.stringify(read.prepare("SELECT * FROM activities").all());
    read.close();
    expect(stored).not.toContain("private message");
    expect(stored).not.toContain(first.lease);
    expect(inbox.complete(first.sendId, first.lease)).toBe(true);
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 2);
    expect(inbox.claim(key, body)).toEqual({ state: "done", sendId: first.sendId });
  });

  it("rejects a changed payload with the same activity identity", () => {
    const first = inbox.claim(key, body);
    expect(inbox.claim(key, new TextEncoder().encode("changed"))).toEqual({ state: "conflict", sendId: first.sendId });
  });

  it("recovers an expired lease with the same send id and rejects the old owner", () => {
    const first = inbox.claim(key, body, 1000);
    if (first.state !== "claimed") throw new Error("claim failed");
    now += 1000;
    const recovered = inbox.claim(key, body, 1000);
    expect(recovered.state).toBe("claimed");
    if (recovered.state !== "claimed") throw new Error("recovery failed");
    expect(recovered.sendId).toBe(first.sendId);
    expect(inbox.complete(first.sendId, first.lease)).toBe(false);
    expect(inbox.complete(recovered.sendId, recovered.lease)).toBe(true);
  });

  it("normalizes tenant and app GUIDs, isolates conversations, and fails closed at capacity", () => {
    const first = inbox.claim(key, body);
    expect(inbox.claim({ ...key, appId: key.appId.toUpperCase(), tenantId: key.tenantId.toUpperCase() }, body).state).toBe("busy");
    const second = inbox.claim({ ...key, conversationId: "conversation-2" }, body);
    expect(second.state).toBe("claimed");
    expect(second.sendId).not.toBe(first.sendId);
    expect(inbox.claim({ ...key, activityId: "activity-2" }, body).state).toBe("full");
  });

  it("cleans completed authenticated activities only after their verified deadline and rejects replay", () => {
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1, verify);
    const deadline = now + 1000, proof = sign(key, body, deadline);
    const first = inbox.claim(key, body, 1000, proof);
    if (first.state !== "claimed") throw new Error("claim failed");
    expect(inbox.complete(first.sendId, first.lease)).toBe(true);
    expect(inbox.claim({ ...key, activityId: "activity-2" }, body, 1000, sign({ ...key, activityId: "activity-2" }, body, deadline + 1000)).state).toBe("full");
    now = deadline;
    expect(inbox.claim(key, body, 1000, proof).state).toBe("expired");
    expect(inbox.claim({ ...key, activityId: "activity-2" }, body, 1000, sign({ ...key, activityId: "activity-2" }, body, deadline + 1000)).state).toBe("claimed");
    now -= 500;
    expect(inbox.claim(key, body, 1000, proof).state).toBe("expired");
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1, verify);
    expect(inbox.claim(key, body, 1000, proof).state).toBe("expired");
  });

  it("rejects missing or altered proofs and refuses later proof-policy downgrade", () => {
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1, verify);
    const proof = sign(key, body, now + 1000);
    expect(inbox.claim(key, body).state).toBe("unverified");
    expect(inbox.claim(key, encoder.encode("different"), 1000, proof).state).toBe("unverified");
    expect(inbox.claim({ ...key, activityId: "different" }, body, 1000, proof).state).toBe("unverified");
    expect(inbox.claim(key, body, 1000, proof).state).toBe("claimed");
    expect(inbox.claim(key, body, 1000, sign(key, body, now + 2000)).state).toBe("conflict");
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1);
    expect(inbox.claim(key, body).state).toBe("unverified");
  });

  it("keeps an in-flight expired activity until its lease ends", () => {
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1, verify);
    const deadline = now + 1000;
    const first = inbox.claim(key, body, 3000, sign(key, body, deadline));
    if (first.state !== "claimed") throw new Error("claim failed");
    now = deadline;
    const next = { ...key, activityId: "next" };
    expect(inbox.claim(next, body, 1000, sign(next, body, now + 5000)).state).toBe("full");
    now += 2000;
    expect(inbox.claim(next, body, 1000, sign(next, body, now + 5000)).state).toBe("claimed");
    expect(inbox.complete(first.sendId, first.lease)).toBe(false);
  });

  it("does not infer an expiry for records created without an authenticated proof", () => {
    const first = inbox.claim(key, body);
    if (first.state !== "claimed") throw new Error("claim failed");
    expect(inbox.complete(first.sendId, first.lease)).toBe(true);
    inbox.close();
    inbox = new TeamsActivityInbox(path, () => now, 1, verify);
    now += 10_000;
    expect(inbox.claim({ ...key, activityId: "activity-2" }, body, 1000, sign({ ...key, activityId: "activity-2" }, body, now + 1000)).state).toBe("full");
    expect(inbox.claim(key, body, 1000, sign(key, body, now + 1000)).state).toBe("done");
  });

  it("upgrades an existing database without dropping legacy receipts", () => {
    const legacyPath = join(dir, "legacy.db");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE activities (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL, lease TEXT NOT NULL, lease_until INTEGER NOT NULL)");
    legacy.prepare("INSERT INTO activities VALUES (?, ?, ?, ?, ?)").run("legacy", "hash", "done", "", 0);
    legacy.close();
    const upgraded = new TeamsActivityInbox(legacyPath, () => now, 1, verify);
    try {
      expect(upgraded.claim(key, body, 1000, sign(key, body, now + 1000)).state).toBe("full");
    } finally { upgraded.close(); }
  });
});
