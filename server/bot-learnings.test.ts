import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createBotLearnings } from "./bot-learnings.ts";
import type { TeamMemoryInput } from "./team-memory.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const generationA = "10000000-0000-4000-8000-000000000001";
const generationB = "10000000-0000-4000-8000-000000000002";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bot-learnings-")); dirs.push(dir);
  let generation: string | null = generationA;
  const reviewers = new Set(["manager"]);
  const access = { botGeneration: (bot: string) => bot === "a" ? generation : bot === "b" ? generationB : null,
    canPropose: (_bot: string, session: string) => session === "member",
    canReview: (_bot: string, session: string) => reviewers.has(session),
    allowContent: (input: TeamMemoryInput) => !input.detail.includes("private") };
  const file = join(dir, "learnings.sqlite");
  const store = createBotLearnings(file, access);
  return { store, access, file, reviewers, recreate: () => { generation = generationB; } };
}
const sample = { kind: "term" as const, name: "Roadmap", detail: "Review every Friday" };

it("injects only an approved note into the exact bot and retains the decision after restart", () => {
  const s = setup();
  const pending = s.store.propose("a", "member", sample);
  expect(s.store.prompt("a")).toBe("");
  expect(s.store.prompt("b")).toBe("");
  const accepted = s.store.resolve("a", "manager", pending.id, pending.revision, "accept");
  expect(accepted.state).toBe("accepted");
  expect(s.store.prompt("a")).toContain("Review every Friday");
  expect(s.store.prompt("b")).toBe("");
  s.store.close();
  const reopened = createBotLearnings(s.file, s.access);
  expect(reopened.prompt("a")).toContain("Review every Friday");
  reopened.close();
});

it("rejects unauthorized, stale, cross-bot and revoked review attempts", () => {
  const s = setup();
  expect(() => s.store.propose("a", "stranger", sample)).toThrow("No such bot or access");
  const pending = s.store.propose("a", "member", sample);
  expect(() => s.store.list("a", "member")).toThrow("No such bot or access");
  expect(() => s.store.resolve("b", "manager", pending.id, 1, "accept")).toThrow("No such learning");
  expect(() => s.store.resolve("a", "manager", pending.id, 2, "accept")).toThrow("Learning changed");
  s.reviewers.delete("manager");
  expect(() => s.store.resolve("a", "manager", pending.id, 1, "accept")).toThrow("No such bot or access");
  expect(s.store.prompt("a")).toBe("");
  s.store.close();
});

it("does not reuse approved learning after the same bot ID is recreated", () => {
  const s = setup();
  const pending = s.store.propose("a", "member", sample);
  s.store.resolve("a", "manager", pending.id, 1, "accept");
  s.recreate();
  expect(s.store.prompt("a")).toBe("");
  expect(s.store.list("a", "manager")).toEqual([]);
  expect(() => s.store.resolve("a", "manager", pending.id, 1, "accept")).toThrow("No such learning");
  s.store.close();
});

it("rejects duplicate accepted facts and does not inject rejected proposals", () => {
  const s = setup();
  const first = s.store.propose("a", "member", sample);
  const second = s.store.propose("a", "member", { ...sample, detail: "another" });
  s.store.resolve("a", "manager", first.id, 1, "accept");
  expect(() => s.store.resolve("a", "manager", second.id, 1, "accept")).toThrow("already has this key");
  s.store.resolve("a", "manager", second.id, 1, "reject");
  expect(s.store.prompt("a")).not.toContain("another");
  s.store.close();
});

it("uses persisted review state across independent instances", () => {
  const s = setup();
  const second = createBotLearnings(s.file, s.access);
  const item = s.store.propose("a", "member", sample);
  second.resolve("a", "manager", item.id, 1, "accept");
  expect(() => s.store.resolve("a", "manager", item.id, 1, "reject")).toThrow("Learning changed");
  expect(s.store.prompt("a")).toContain("Review every Friday");
  second.close(); s.store.close();
});

it("refuses a rejected privacy check both on proposal and on an edited approval", () => {
  const s = setup();
  expect(() => s.store.propose("a", "member", { ...sample, detail: "private data" })).toThrow("cannot be shared");
  const item = s.store.propose("a", "member", sample);
  expect(() => s.store.resolve("a", "manager", item.id, 1, "accept", { ...sample, detail: "private data" })).toThrow("cannot be shared");
  expect(s.store.prompt("a")).toBe("");
  expect(s.store.list("a", "manager")).toMatchObject([{ state: "proposed", revision: 1 }]);
  s.store.close();
});

it("rechecks the current privacy policy on an unedited approval, but permits rejection", () => {
  const s = setup();
  const item = s.store.propose("a", "member", sample);
  s.access.allowContent = () => false;
  expect(() => s.store.resolve("a", "manager", item.id, 1, "accept")).toThrow("cannot be shared");
  expect(s.store.prompt("a")).toBe("");
  expect(s.store.list("a", "manager")).toMatchObject([{ state: "proposed", revision: 1 }]);
  expect(s.store.resolve("a", "manager", item.id, 1, "reject")).toMatchObject({ state: "rejected" });
  s.store.close();
});
