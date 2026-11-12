import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createBotManagers } from "./bot-managers.ts";
import { managerMembershipFixture } from "./testing/manager-membership-fixture.ts";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openbot-managers-"));
  dirs.push(dir);
  const people = managerMembershipFixture();
  const file = join(dir, "bot-managers.json");
  const deps = { file, botExists: (id: string) => id === "bot-a" || id === "bot-b", membershipId: (email: string) => people.membershipId(email), isCurrentSession: (email: string, id: string) => people.isCurrentSession(email, id) };
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

it("fails closed without overwriting duplicate persisted grants", () => {
  const { people, file, deps } = fixture();
  people.seen("ada@example.test", "member", true, "ada-session");
  const grant = { botId: "bot-a", email: "ada@example.test", membershipId: people.membershipId("ada@example.test") };
  const original = JSON.stringify({ version: 1, grants: [grant, grant] });
  writeFileSync(file, original);
  const managers = createBotManagers(deps);
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
  expect(readFileSync(file, "utf8")).toBe(original);
});

it("discards deleted bots' grants before a bot with that id is reintroduced", () => {
  const { people, file } = fixture();
  const bots = new Set(["bot-a"]);
  const deps = { file, botExists: (id: string) => bots.has(id), membershipId: (email: string) => people.membershipId(email), isCurrentSession: (email: string, id: string) => people.isCurrentSession(email, id) };
  people.seen("ada@example.test", "member", true, "ada-session");
  let managers = createBotManagers(deps);
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  bots.delete("bot-a");
  managers.discard("bot-a");
  bots.add("bot-a");
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  bots.delete("bot-a");
  managers = createBotManagers(deps);
  bots.add("bot-a");
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
});

it("fails closed when revoking a deleted bot's grants cannot be persisted", () => {
  const { people, file, managers } = fixture();
  people.seen("ada@example.test", "member", true, "ada-session");
  managers.replace("bot-a", [{ email: "ada@example.test", membershipId: people.membershipId("ada@example.test")! }], managers.list("bot-a").revision);
  rmSync(file);
  mkdirSync(file);
  expect(() => managers.discard("bot-a")).toThrow();
  expect(managers.has("bot-a", "ada@example.test", "ada-session")).toBe(false);
  expect(() => managers.list("bot-a")).toThrow(/unavailable/);
});
