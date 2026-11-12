import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { appendTeamMemoryReview, bindDecisionRetention, bindTeamMemoryAuditPruner, DEFAULT_DECISION_RETENTION_DAYS, prepareTeamMemoryReviewWriter, pruneDecisions, readDecisions, withDecisionActor } from "./decision-log.ts";
import { TeamMemory } from "./team-memory.ts";
import { teamMemoryAuditActor } from "./team-memory-audit-actor.ts";
import { createTeamMemoryRequests } from "./team-memory-requests.ts";

it("replays a failed audit after restart with the original reviewer, exactly once", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-recovery-"));
  try {
    const file = join(dir, "memory.json");
    const messages: any[] = [];
    const proposalLogs: any[] = [];
    const store = {
      messagesFor: () => messages,
      appendMessage: (_thread: string, message: any) => { const row = { ...message, id: "card" }; messages.push(row); return row; },
      patchMessage: (_thread: string, _id: string, patch: any) => Object.assign(messages[0], patch),
      bot: () => null,
      botByThread: () => ({ id: "bot", name: "Bot" }),
    };
    const make = (memory: TeamMemory, fail: boolean) => createTeamMemoryRequests({
      teamMemory: memory, store, requireReview: true, sectionKey: (section) => section ?? "",
      decide: (row) => { proposalLogs.push(row); }, audit: (id, row) => { if (fail) throw new Error("unavailable"); appendTeamMemoryReview(dir, id, row); },
    });
    const first = make(new TeamMemory(file), true);
    const proposed = first.submit({ id: "bot", name: "Bot", color: "blue" }, "thread", false, { kind: "decision", name: "Policy", detail: "Use amber" }, null);
    const reviewer = { kind: "session" as const, sessionId: "reviewer", label: "private@example.test sk-abcdefghijklmnopqrstuv", userId: "private@example.test", email: "private@example.test" };
    expect(messages[0].card.subtitle).toContain("Use amber");
    expect(JSON.stringify(proposalLogs)).not.toContain("Use amber");
    expect(withDecisionActor(reviewer, () => first.resolve("thread", proposed.body.requestId!, "allow"))?.outcome).toBe("allowed-once");
    expect(readDecisions(dir, 10)).toEqual([]);
    const restarted = make(new TeamMemory(file), false);
    withDecisionActor({ kind: "session", sessionId: "other", label: "Other" }, () => { restarted.reconcile(); restarted.reconcile(); });
    expect(readDecisions(dir, 10)).toMatchObject([{ requestId: proposed.body.requestId, decision: "user-approved", actor: teamMemoryAuditActor(reviewer) }]);
    expect(readDecisions(dir, 10)).toHaveLength(1);
    expect(JSON.stringify(readDecisions(dir, 10))).not.toContain("private@example.test");
    expect(JSON.stringify(new TeamMemory(file).list("", true))).not.toContain("private@example.test");
    expect(JSON.stringify(new TeamMemory(file).list("", true))).not.toContain("sk-abcdefghijklmnopqrstuv");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("applies a shortened retention period on the next review projection", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-next-review-"));
  const now = Date.now();
  const day = 86_400_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(now - 40 * day);
  let days = 90;
  let unbind: (() => void) | undefined;
  try {
    bindDecisionRetention(() => days);
    const memory = new TeamMemory(join(dir, "memory.json"));
    unbind = bindTeamMemoryAuditPruner(dir, (cutoff) => { memory.expireReviewAudit(cutoff); });
    const entry = memory.propose("", { kind: "term", name: "Policy", detail: "Use amber" }, { botId: "bot", botName: "Bot", threadId: "thread", at: Date.now() }).entry;
    memory.resolve("", entry.id, "accept", undefined, { actor: { kind: "session", sessionId: "reviewer", label: "private@example.test" } });
    const receipt = memory.reviewReceipts()[0]!;
    appendTeamMemoryReview(dir, entry.id, { at: new Date(receipt.at).toISOString(), threadId: "thread", requestId: entry.id, decision: "user-approved", source: "user", actor: receipt.audit?.actor });
    clock.mockReturnValue(now);
    days = 30;
    appendTeamMemoryReview(dir, "new", { at: new Date(now).toISOString(), threadId: "thread", requestId: "new", decision: "user-denied", source: "user" });
    expect(memory.reviewReceipts()[0]?.audit).toBeUndefined();
    expect(readDecisions(dir, 10).map(row => row.requestId)).toEqual(["new"]);
  } finally {
    unbind?.();
    bindDecisionRetention(() => DEFAULT_DECISION_RETENTION_DAYS);
    clock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("cleans once before projecting multiple review receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-batch-"));
  let unbind: (() => void) | undefined;
  try {
    const memory = new TeamMemory(join(dir, "memory.json"));
    const actor = { kind: "session" as const, sessionId: "reviewer", label: "private@example.test" };
    for (const name of ["One", "Two", "Three"]) {
      const entry = memory.propose("", { kind: "term", name, detail: "Details" }, { botId: "bot", botName: "Bot", threadId: "thread", at: Date.now() }).entry;
      memory.resolve("", entry.id, "accept", undefined, { actor });
    }
    let cleans = 0;
    let fail = true;
    unbind = bindTeamMemoryAuditPruner(dir, (cutoff) => { cleans++; if (fail) throw new Error("cleanup unavailable"); memory.expireReviewAudit(cutoff); });
    const requests = createTeamMemoryRequests({
      teamMemory: memory, sectionKey: (section) => section ?? "", decide: () => {},
      prepareAudit: () => prepareTeamMemoryReviewWriter(dir), threadExists: () => false,
      store: { messagesFor: () => [], appendMessage: () => ({ id: "card" }), patchMessage: () => {}, bot: () => null, botByThread: () => null },
    });
    expect(requests.reconcile()).toBe(1);
    expect(cleans).toBe(1);
    expect(readDecisions(dir, 10)).toHaveLength(0);
    fail = false;
    expect(requests.reconcile()).toBe(0);
    expect(cleans).toBe(2);
    expect(readDecisions(dir, 10)).toHaveLength(3);
    expect(requests.reconcile()).toBe(0);
    expect(cleans).toBe(3);
    expect(readDecisions(dir, 10)).toHaveLength(3);
  } finally { unbind?.(); rmSync(dir, { recursive: true, force: true }); }
});

it("does not write a newly expired event using an earlier prepared writer", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-writer-"));
  let days = 90;
  try {
    bindDecisionRetention(() => days);
    const writer = prepareTeamMemoryReviewWriter(dir);
    days = 30;
    writer("old", { at: new Date(Date.now() - 40 * 86_400_000).toISOString(), threadId: "thread", requestId: "old", decision: "user-approved", source: "user" });
    expect(readDecisions(dir, 10)).toEqual([]);
  } finally { bindDecisionRetention(() => DEFAULT_DECISION_RETENTION_DAYS); rmSync(dir, { recursive: true, force: true }); }
});

it("never revives a review or its identity after retention is shortened, pruned, then widened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-retention-"));
  let unbind: (() => void) | undefined;
  try {
    const file = join(dir, "memory.json");
    const memory = new TeamMemory(file);
    const entry = memory.propose("", { kind: "decision", name: "Policy", detail: "Use amber" }, { botId: "bot", botName: "Bot", threadId: "thread", at: Date.now() }).entry;
    const actor = { kind: "session" as const, sessionId: "private-session", label: "Reviewer" };
    memory.resolve("", entry.id, "accept", undefined, { actor });
    const receipt = memory.reviewReceipts()[0]!;
    const row = { at: new Date(receipt.at).toISOString(), threadId: "thread", requestId: entry.id, decision: "user-approved" as const, source: "user" as const, actor };
    appendTeamMemoryReview(dir, entry.id, row);
    expect(readDecisions(dir, 10)).toHaveLength(1);
    unbind = bindTeamMemoryAuditPruner(dir, (cutoff) => { memory.expireReviewAudit(cutoff); });
    const day = 86_400_000;
    await pruneDecisions(dir, 30, new Date(receipt.at + 40 * day));
    unbind();
    unbind = undefined;
    const restarted = new TeamMemory(file);
    expect(restarted.reviewReceipts()[0]).toMatchObject({ answer: "allow", summary: expect.stringContaining("Policy") });
    expect(restarted.reviewReceipts()[0]?.audit).toBeUndefined();
    appendTeamMemoryReview(dir, entry.id, row);
    expect(readDecisions(dir, 10)).toEqual([]);
    expect(JSON.stringify(restarted.list("", true))).not.toContain("private-session");
  } finally { unbind?.(); rmSync(dir, { recursive: true, force: true }); }
});

it("keeps the prune watermark after receipt cleanup fails and retries cleanup with the same boundary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-audit-prune-retry-"));
  let unbind: (() => void) | undefined;
  try {
    const file = join(dir, "memory.json");
    const memory = new TeamMemory(file);
    const entry = memory.propose("", { kind: "term", name: "Release", detail: "Ship" }, { botId: "bot", botName: "Bot", threadId: "thread", at: Date.now() }).entry;
    const actor = { kind: "session" as const, sessionId: "private-session", label: "Reviewer" };
    memory.resolve("", entry.id, "accept", undefined, { actor });
    const receipt = memory.reviewReceipts()[0]!;
    const row = { at: new Date(receipt.at).toISOString(), threadId: "thread", requestId: entry.id, decision: "user-approved" as const, source: "user" as const, actor };
    appendTeamMemoryReview(dir, entry.id, row);
    unbind = bindTeamMemoryAuditPruner(dir, () => { throw new Error("write failed"); });
    const day = 86_400_000;
    await expect(pruneDecisions(dir, 30, new Date(receipt.at + 40 * day))).rejects.toThrow("write failed");
    expect(() => appendTeamMemoryReview(dir, entry.id, row)).toThrow("write failed");
    expect(readDecisions(dir, 10)).toEqual([]);
    unbind();
    const restarted = new TeamMemory(file);
    unbind = bindTeamMemoryAuditPruner(dir, (cutoff) => { restarted.expireReviewAudit(cutoff); });
    await pruneDecisions(dir, 90, new Date(receipt.at + 40 * day));
    expect(restarted.reviewReceipts()[0]?.audit).toBeUndefined();
    expect(JSON.stringify(new TeamMemory(file).list("", true))).not.toContain("private-session");
  } finally { unbind?.(); rmSync(dir, { recursive: true, force: true }); }
});
