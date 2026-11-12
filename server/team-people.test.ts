import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTeamPeople } from "./team-people.ts";

const dirs: string[] = [];
const dir = () => { const made = mkdtempSync(join(tmpdir(), "omb-team-people-")); dirs.push(made); return made; };
afterEach(() => { for (const made of dirs.splice(0)) rmSync(made, { recursive: true, force: true }); });

describe("the people a Team Cloud bot can report to", () => {
  it("are everyone the Admin paired, kept across a restart, by address", () => {
    const at = dir();
    const people = createTeamPeople(at);
    people.seen(" Ada@Acme.test ", "admin");
    people.seen("bob@acme.test", "member");
    expect(createTeamPeople(at).list().map((person) => [person.email, person.role])).toEqual([["ada@acme.test", "admin"], ["bob@acme.test", "member"]]);
    expect(people.has("ADA@acme.test")).toBe(true);
    expect(people.has("cleo@acme.test")).toBe(false);
  });

  it("migrates a legacy member on verified pairing, preserves its generation on restart, and replaces it after rejoining", () => {
    const at = dir();
    writeFileSync(join(at, "team-people.json"), JSON.stringify({ version: 1, people: [
      { email: "bob@acme.test", role: "member", firstSeenAt: 1, lastSeenAt: 2 },
    ] }));
    const people = createTeamPeople(at);
    expect(people.membershipId("bob@acme.test")).toBeNull();
    people.seen("bob@acme.test", "member");
    const first = people.membershipId("bob@acme.test");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    const reopened = createTeamPeople(at);
    expect(reopened.membershipId("bob@acme.test")).toBe(first);
    reopened.left("bob@acme.test");
    expect(reopened.membershipId("bob@acme.test")).toBeNull();
    reopened.seen("bob@acme.test", "member");
    expect(reopened.membershipId("bob@acme.test")).not.toBe(first);
    expect(createTeamPeople(at).membershipId("bob@acme.test")).toBe(reopened.membershipId("bob@acme.test"));
  });

  it("stop offering someone the Admin said left, until they are paired again", () => {
    const at = dir();
    const people = createTeamPeople(at);
    people.seen("bob@acme.test", "member");
    people.left("bob@acme.test");
    const reread = createTeamPeople(at);
    expect(reread.list()).toEqual([]);
    expect([reread.has("bob@acme.test"), reread.gone("bob@acme.test")]).toEqual([false, true]);
    reread.seen("bob@acme.test", "member");
    expect([reread.has("bob@acme.test"), reread.gone("bob@acme.test")]).toEqual([true, false]);
  });
});
