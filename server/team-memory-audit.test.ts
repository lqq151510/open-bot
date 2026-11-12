import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { pruneTeamMemoryReviews, readTeamMemoryReviews, recordTeamMemoryReview } from "./team-memory-audit.ts";
import type { DecisionRow } from "./decision-log.ts";
import { teamMemoryAuditActor } from "./team-memory-audit-actor.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "team-review-audit-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it("stores one durable event across retries and refuses a conflicting event", () => {
  const at = Date.now();
  const row: DecisionRow = { at: new Date(at).toISOString(), threadId: "thread", requestId: "request", botId: "bot", tool: "propose_team_memory", decision: "user-approved", source: "user", actor: { kind: "session", sessionId: "session", label: "Admin" } };
  recordTeamMemoryReview(dir, "request", row, at - 1000);
  recordTeamMemoryReview(dir, "request", row, at - 1000);
  expect(readTeamMemoryReviews(dir, at - 1000, at + 1000)).toEqual([{ ...row, actor: teamMemoryAuditActor(row.actor) }]);
  expect(() => recordTeamMemoryReview(dir, "request", { ...row, decision: "user-denied" }, at - 1000)).toThrow("audit ID conflict");
  expect(readTeamMemoryReviews(dir, at - 1000, at + 1000)).toEqual([{ ...row, actor: teamMemoryAuditActor(row.actor) }]);
  if (process.platform !== "win32") expect(statSync(join(dir, "team-memory-audit.db")).mode & 0o777).toBe(0o600);
});

it("does not resurrect a pruned event from a saved receipt", () => {
  const at = Date.now();
  const row: DecisionRow = { at: new Date(at).toISOString(), threadId: "thread", decision: "user-denied", source: "user" };
  recordTeamMemoryReview(dir, "request", row, at - 1);
  pruneTeamMemoryReviews(dir, at + 1);
  recordTeamMemoryReview(dir, "request", row, at - 1);
  expect(readTeamMemoryReviews(dir, at - 1, at + 1000)).toEqual([]);
});

it("persists a prune watermark before the first event and never moves it backwards", () => {
  const at = Date.now();
  const row: DecisionRow = { at: new Date(at).toISOString(), threadId: "thread", decision: "user-approved", source: "user" };
  expect(pruneTeamMemoryReviews(dir, at + 1000)).toBe(at + 1000);
  expect(pruneTeamMemoryReviews(dir, at - 1000)).toBe(at + 1000);
  recordTeamMemoryReview(dir, "late", row, at - 1000);
  expect(readTeamMemoryReviews(dir, at - 1000, at + 2000)).toEqual([]);
});

it("does not persist caller supplied labels, email, user IDs or memory text", () => {
  const at = Date.now();
  const row: DecisionRow = { at: new Date(at).toISOString(), threadId: "thread", requestId: "request", botName: "ada@example.test", summary: "api_key=supersecretvalue123", tool: "anything", decision: "user-approved", source: "user", actor: { kind: "session", sessionId: "server-generated-session", label: "ada@example.test sk-abcdefghijklmnopqrstuv", email: "ada@example.test", userId: "ada@example.test" } };
  recordTeamMemoryReview(dir, "request", row, at - 1000);
  const [safe] = readTeamMemoryReviews(dir, at - 1000, at + 1000);
  expect(safe?.actor).toEqual(teamMemoryAuditActor(row.actor));
  expect(safe?.summary).toBeUndefined();
  expect(safe?.botName).toBeUndefined();
  const bytes = readFileSync(join(dir, "team-memory-audit.db"), "utf8");
  for (const sensitive of ["ada@example.test", "supersecretvalue123", "sk-abcdefghijklmnopqrstuv", "server-generated-session"]) expect(bytes).not.toContain(sensitive);
});
