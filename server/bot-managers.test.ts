import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createBotManagers } from "./bot-managers.ts";
import { managerMembershipFixture } from "./testing/manager-membership-fixture.ts";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openbot-managers-"));
  dirs.push(dir);
  const people = managerMembershipFixture();
  const file = join(dir, "bot-managers.json");
  const deps = { file, botGeneration: (id: string) => id === "bot-a" || id === "bot-b" ? "00000000-0000-4000-8000-000000000001" : null, membershipId: (email: string) => people.membershipId(email), isCurrentSession: (email: string, id: string) => people.isCurrentSession(email, id) };
  return { people, file, deps, managers: createBotManagers(deps) };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("isolates grants by bot, persists them, and rejects stale replacements", () => {
  const { people, managers, deps } = fixture();
  people.seen("Ada@example.test", "member", true, "session-ada");
  const initial = managers.list("bot-a");
  const saved = managers.replace("bot-a", [{ email: " ADA@example.test ", membershipId: people.membershipId("ada@example.test")! }], initial.revision);
  expect(saved.emails).toEqual(["ada@example.test"]);
  expect(managers.has("bot-a", "ada@example.test", "session-ada")).toBe(true);
  expect(managers.has("bot-b", "ada@example.test", "session-ada")).toBe(false);
  expect(createBotManagers(deps).has("bot-a", "ada@example.test", "session-ada")).toBe(true);
  expect(() => managers.replace("bot-a", [], initial.revision)).toThrow(/changed/);
  expect(managers.list("bot-a").emails).toEqual(saved.emails);
});

it("compares persisted revisions across separate instances and preserves other bots", () => {
  const { people, deps, managers: first } = fixture();
  people.seen("ada@example.test", "member", true, "session-ada");
  people.seen("ben@example.test", "member", true, "session-ben");
  const second = createBotManagers(deps);
  const stale = first.list("bot-a").revision;
  expect(second.list("bot-a").revision).toBe(stale);
  first.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], stale);
  expect(() => second.replace("bot-a", [{ email: "ben@example.test", membershipId: people.membershipId("ben@example.test")! }], stale)).toThrow(/changed/);
  second.replace("bot-b", [{ email: "ben@example.test", membershipId: people.membershipId("ben@example.test")! }], second.list("bot-b").revision);
  expect(first.has("bot-a", "ada@example.test", "session-ada")).toBe(true);
  expect(first.has("bot-b", "ben@example.test", "session-ben")).toBe(true);
});

it("fails closed without losing grants when another writer holds the database", () => {
  const { people, file, managers } = fixture();
  people.seen("ada@example.test", "member", true, "session-ada");
  const initial = managers.list("bot-a").revision;
  const saved = managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], initial);
  const lock = new DatabaseSync(`${file}.sqlite`);
  lock.exec("BEGIN IMMEDIATE");
  try {
    expect(() => managers.replace("bot-a", [], saved.revision)).toThrow(/unavailable/);
  } finally {
    lock.exec("ROLLBACK");
    lock.close();
  }
  expect(managers.has("bot-a", "ada@example.test", "session-ada")).toBe(true);
  expect(managers.list("bot-a").revision).toBe(saved.revision);
}, 5_000);

it("rejects an old revision after grants change and return to their original state", () => {
  const { people, managers } = fixture();
  people.seen("ada@example.test", "member", true, "session-ada");
  const empty = managers.list("bot-a").revision;
  const saved = managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], empty);
  const removed = managers.replace("bot-a", [], saved.revision);
  expect(removed.emails).toEqual([]);
  expect(removed.revision).not.toBe(empty);
  expect(() => managers.replace("bot-a", [], empty)).toThrow(/changed/);
});

it("recovers when a process dies before publishing the initialized database", () => {
  const { file, managers } = fixture();
  const script = [
    'import fs from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'fs.linkSync = () => process.exit(73); syncBuiltinESMExports();',
    'const { createBotManagers } = await import("./server/bot-managers.ts");',
    'const store = createBotManagers({ file: process.argv[1], botGeneration: () => "00000000-0000-4000-8000-000000000001", membershipId: () => null, isCurrentSession: () => false });',
    'store.list("bot-a");',
  ].join("\n");
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, file], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
  expect(child.status).toBe(73);
  expect(existsSync(`${file}.sqlite`)).toBe(false);
  expect(managers.list("bot-a").emails).toEqual([]);
  expect(existsSync(`${file}.sqlite`)).toBe(true);
});

it("removes a published staging link left by a crash before using the database", () => {
  const { file, managers } = fixture();
  const script = [
    'import fs from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'fs.rmSync = () => process.exit(74); syncBuiltinESMExports();',
    'const { createBotManagers } = await import("./server/bot-managers.ts");',
    'const store = createBotManagers({ file: process.argv[1], botGeneration: () => "00000000-0000-4000-8000-000000000001", membershipId: () => null, isCurrentSession: () => false });',
    'store.list("bot-a");',
  ].join("\n");
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, file], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
  expect(child.status).toBe(74);
  expect(statSync(`${file}.sqlite`).nlink).toBe(2);
  expect(managers.list("bot-a").emails).toEqual([]);
  expect(statSync(`${file}.sqlite`).nlink).toBe(1);
});

it("refuses an existing empty database without overwriting it", () => {
  const { file, managers } = fixture();
  writeFileSync(`${file}.sqlite`, "");
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
  expect(statSync(`${file}.sqlite`).size).toBe(0);
});

it("allows two processes to initialize the same absent database concurrently", async () => {
  const { file } = fixture();
  const script = [
    'import { createBotManagers } from "./server/bot-managers.ts";',
    'const store = createBotManagers({ file: process.argv[1], botGeneration: () => "00000000-0000-4000-8000-000000000001", membershipId: () => null, isCurrentSession: () => false });',
    'process.stdout.write("ready\\n");',
    'await new Promise(resolve => process.stdin.once("data", resolve));',
    'try { process.stdout.write(store.list("bot-a").revision + "\\n"); } catch { process.exitCode = 1; }',
  ].join("\n");
  const runs = Array.from({ length: 2 }, () => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, file], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (data: string) => { output += data; });
    child.stderr.resume();
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { child, finished, output: () => output };
  });
  try {
    await vi.waitFor(() => expect(runs.every((run) => run.output().includes("ready\n"))).toBe(true), { timeout: 10_000 });
    for (const run of runs) run.child.stdin.end("go");
    expect(await Promise.all(runs.map((run) => run.finished))).toEqual([0, 0]);
    const revisions = runs.map((run) => run.output().trim().split("\n").at(-1));
    expect(revisions[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(revisions[1]).toBe(revisions[0]);
  } finally {
    for (const run of runs) run.child.kill();
  }
}, 15_000);

it("serializes competing processes using the same revision", async () => {
  const { people, file, managers } = fixture();
  people.seen("ada@example.test", "member", true, "session-ada");
  people.seen("ben@example.test", "member", true, "session-ben");
  const revision = managers.list("bot-a").revision;
  const script = [
    'import { createBotManagers } from "./server/bot-managers.ts";',
    'const [file, revision, email, membershipId] = process.argv.slice(1);',
    'const store = createBotManagers({ file, botGeneration: () => "00000000-0000-4000-8000-000000000001", membershipId: () => membershipId, isCurrentSession: () => true });',
    'process.stdout.write("ready\\n");',
    'await new Promise(resolve => process.stdin.once("data", resolve));',
    'try { store.replace("bot-a", [{ email, membershipId }], revision); process.stdout.write("ok\\n"); }',
    'catch (error) { process.stdout.write(error.status === 409 ? "conflict\\n" : "error\\n"); }',
  ].join("\n");
  const runs = ["ada@example.test", "ben@example.test"].map((email) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, file, revision, email, people.membershipId(email)!], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (data: string) => { output += data; });
    child.stderr.resume();
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { child, finished, output: () => output };
  });
  try {
    await vi.waitFor(() => expect(runs.every((run) => run.output().includes("ready\n"))).toBe(true), { timeout: 10_000 });
    for (const run of runs) run.child.stdin.end("go");
    expect(await Promise.all(runs.map((run) => run.finished))).toEqual([0, 0]);
    expect(runs.map((run) => run.output().trim().split("\n").at(-1)).sort()).toEqual(["conflict", "ok"]);
    expect(managers.list("bot-a").emails).toHaveLength(1);
  } finally {
    for (const run of runs) run.child.kill();
  }
}, 15_000);

it("does not resurrect an old grant after a member leaves and rejoins", () => {
  const { people, managers } = fixture();
  people.seen("ada@example.test", "member", true, "session-ada");
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  people.left("ada@example.test");
  expect(managers.has("bot-a", "ada@example.test", "session-ada")).toBe(false);
  people.seen("ada@example.test", "member", true, "session-new");
  expect(managers.has("bot-a", "ada@example.test", "session-new")).toBe(false);
  const renewed = managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  expect(renewed.emails).toEqual(["ada@example.test"]);
  expect(managers.has("bot-a", "ada@example.test", "session-new")).toBe(true);
  expect(managers.has("bot-a", "ada@example.test", "session-ada")).toBe(false);
});

it("fails closed on unverified members and preserves unreadable grant files", () => {
  const { people, managers, file, deps } = fixture();
  people.seen("ada@example.test", "member");
  expect(() => managers.replace("bot-a", [{ email: "ada@example.test", membershipId: "00000000-0000-4000-8000-000000000000" }], managers.list("bot-a").revision)).toThrow(/verified/);
  writeFileSync(file, "{broken");
  const damaged = createBotManagers(deps);
  expect(damaged.has("bot-a", "ada@example.test", "session-ada")).toBe(false);
  expect(() => damaged.replace("bot-a", [], "anything")).toThrow(/unavailable/);
  expect(readFileSync(file, "utf8")).toBe("{broken");
});

it("does not trust or overwrite legacy grants without a bot generation", () => {
  const { people, file, deps } = fixture();
  people.seen("ada@example.test", "member", true, "ada-session");
  const original = JSON.stringify({ version: 1, grants: [{ botId: "bot-a", email: "ada@example.test", membershipId: people.membershipId("ada@example.test") }] });
  writeFileSync(file, original);
  const managers = createBotManagers(deps);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
  expect(readFileSync(file, "utf8")).toBe(original);
});

it("fails closed without overwriting duplicate persisted grants", () => {
  const { people, file, deps } = fixture();
  people.seen("ada@example.test", "member", true, "ada-session");
  const grant = { botId: "bot-a", botGeneration: "00000000-0000-4000-8000-000000000001", email: "ada@example.test", membershipId: people.membershipId("ada@example.test") };
  const original = JSON.stringify({ version: 3, grants: [grant, grant], revisions: {} });
  const db = new DatabaseSync(`${file}.sqlite`);
  db.exec("CREATE TABLE manager_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
  db.prepare("INSERT INTO manager_state (id, payload) VALUES (1, ?)").run(original);
  db.close();
  const managers = createBotManagers(deps);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
  const check = new DatabaseSync(`${file}.sqlite`, { readOnly: true });
  expect(check.prepare("SELECT payload FROM manager_state WHERE id = 1").get()?.payload).toBe(original);
  check.close();
});

it("keeps old grants inaccessible if a bot ID is recreated without a cleanup", () => {
  const { people, file } = fixture();
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  let current: string | null = first;
  const deps = { file, botGeneration: (id: string) => id === "bot-a" ? current : null, membershipId: (email: string) => people.membershipId(email), isCurrentSession: (email: string, id: string) => people.isCurrentSession(email, id) };
  people.seen("ada@example.test", "member", true, "ada-session");
  let managers = createBotManagers(deps);
  const before = managers.list("bot-a");
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], before.revision);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(true);
  const oldRevision = managers.list("bot-a").revision;
  current = null;
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  current = second;
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(managers.list("bot-a").emails).toEqual([]);
  expect(() => managers.replace("bot-a", [], oldRevision)).toThrow(/changed/);
  managers = createBotManagers(deps);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  const currentRevision = managers.list("bot-a").revision;
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], currentRevision);
  managers.discard("bot-a", first);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(true);
  managers.discard("bot-a", second);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
});

it.each([null, "", "untrusted"])('rejects an unavailable bot generation (%s)', (value) => {
  const { people, file } = fixture();
  const managers = createBotManagers({ file, botGeneration: () => value, membershipId: (email) => people.membershipId(email), isCurrentSession: (email, id) => people.isCurrentSession(email, id) });
  people.seen("ada@example.test", "member", true, "ada-session");
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/trusted bot identity/);
});

it("fails closed when revoking a deleted bot's grants cannot be persisted", () => {
  const { people, file, managers } = fixture();
  people.seen("ada@example.test", "member", true, "ada-session");
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  rmSync(`${file}.sqlite`);
  mkdirSync(`${file}.sqlite`);
  expect(() => managers.discard("bot-a", "00000000-0000-4000-8000-000000000001")).toThrow();
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
});
