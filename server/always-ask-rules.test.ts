import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AlwaysAskRules, alwaysAskRequired } from "./always-ask-rules.ts";
import type { Decider } from "./decider/index.ts";
import { personKey } from "./person-key.ts";

let directory: string;
let file: string;
let rules: AlwaysAskRules;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omb-always-ask-"));
  file = join(directory, "always-ask-rules.json");
  rules = new AlwaysAskRules(file);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("matches exact selectors without sending command text to a decision provider", () => {
  rules.create("tool:mcp__my_server__mail");
  rules.create("command:git status");
  const yesNo = vi.fn<Decider["yesNo"]>();
  expect(alwaysAskRequired(rules, { tool: "mcp__my_server__mail" }, { yesNo })).toBe(true);
  expect(alwaysAskRequired(rules, { tool: "Bash", command: "git status" }, { yesNo })).toBe(true);
  expect(alwaysAskRequired(rules, { tool: "Bash", command: "git status --short" }, { yesNo })).toBe(false);
  expect(alwaysAskRequired(rules, { tool: "Bash" }, { yesNo })).toBe(true);
  expect(yesNo).not.toHaveBeenCalled();
});

it("uses only tool metadata for semantic review and holds on uncertainty or failure", async () => {
  rules.create("Ask before emailing a customer");
  const action = { tool: "Bash", command: "this command must not reach the reviewer" };
  expect(alwaysAskRequired(rules, action, undefined)).toBe(true);
  const yesNo = vi.fn<Decider["yesNo"]>();
  yesNo.mockResolvedValueOnce({ ok: false, reason: "timeout" });
  yesNo.mockResolvedValueOnce({ ok: true, provider: "jev", answers: { type: "yesno", p: 0.6 }, latencyMs: 1 });
  yesNo.mockResolvedValueOnce({ ok: true, provider: "jev", answers: { type: "yesno", p: 0.99 }, latencyMs: 1 });
  await expect(alwaysAskRequired(rules, action, { yesNo })).resolves.toBe(true);
  await expect(alwaysAskRequired(rules, action, { yesNo })).resolves.toBe(true);
  await expect(alwaysAskRequired(rules, action, { yesNo })).resolves.toBe(false);
  expect(yesNo.mock.calls.map(([, state]) => state)).toEqual(Array(3).fill({ tool: "Bash", rules: ["Ask before emailing a customer"] }));
});

it("holds if rules change while review is running or storage is unreadable", async () => {
  rules.create("Ask before emailing a customer");
  const yesNo = vi.fn<Decider["yesNo"]>().mockResolvedValue({ ok: true, provider: "jev", answers: { type: "yesno", p: 0.99 }, latencyMs: 1 });
  const review = alwaysAskRequired(rules, { tool: "Bash" }, { yesNo });
  rules.create("tool:Bash");
  await expect(review).resolves.toBe(true);
  expect(new AlwaysAskRules(file).list()).toEqual(rules.list());

  writeFileSync(file, "broken");
  const unreadable = new AlwaysAskRules(file);
  expect(unreadable.active).toBe(true);
  expect(alwaysAskRequired(unreadable, { tool: "Bash" }, undefined)).toBe(true);
  expect(() => unreadable.create("tool:Bash")).toThrow(/could not be read/);
});

it("loads existing workspace rules as team rules and only joins the active person's rules", () => {
  const owner = personKey({ id: "owner" });
  const member = personKey({ id: "member" });
  const team = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", text: "tool:Bash" };
  writeFileSync(file, JSON.stringify({ version: 1, rules: [team] }));
  rules = new AlwaysAskRules(file);
  rules.create("tool:Read", owner);
  rules.create("tool:Write", member);
  rules = new AlwaysAskRules(file);

  expect(rules.list()).toEqual([team]);
  expect(alwaysAskRequired(rules.forPerson(owner), { tool: "Bash" }, undefined)).toBe(true);
  expect(alwaysAskRequired(rules.forPerson(owner), { tool: "Read" }, undefined)).toBe(true);
  expect(alwaysAskRequired(rules.forPerson(member), { tool: "Read" }, undefined)).toBe(false);
  expect(alwaysAskRequired(rules.forPerson(member), { tool: "Write" }, undefined)).toBe(true);
  expect(alwaysAskRequired(rules.forPerson(), { tool: "Write" }, undefined)).toBe(false);
  const id = rules.list(member)[0]!.id;
  expect(() => rules.update(id, "tool:Read", owner)).toThrow("No such always-ask rule");
  rules.delete(id, owner);
  expect(rules.list(member)).toHaveLength(1);
});

it("keeps an async review valid across another person's edits and holds on changes to its effective rules", async () => {
  const owner = personKey({ id: "owner" });
  const member = personKey({ id: "member" });
  rules.create("Ask before emailing a customer", owner);
  const yesNo = vi.fn<Decider["yesNo"]>().mockResolvedValue({ ok: true, provider: "jev", answers: { type: "yesno", p: 0.99 }, latencyMs: 1 });
  const review = () => alwaysAskRequired(rules.forPerson(owner), { tool: "Bash" }, { yesNo });
  const unaffected = review();
  rules.create("tool:Bash", member);
  await expect(unaffected).resolves.toBe(false);
  const affected = review();
  rules.create("tool:Bash");
  await expect(affected).resolves.toBe(true);
});
