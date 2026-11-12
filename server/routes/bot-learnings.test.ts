import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createBotLearnings } from "../bot-learnings.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createBotLearningsRoutes } from "./bot-learnings.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bot-learning-routes-")); dirs.push(dir);
  const reviewers = new Set(["manager"]);
  const learnings = createBotLearnings(join(dir, "notes.sqlite"), {
    botGeneration: (id) => id === "a" ? "10000000-0000-4000-8000-000000000001" : null,
    canPropose: (_id, session) => session === "member",
    canReview: (_id, session) => reviewers.has(session),
    allowContent: (input) => !input.detail.includes("private"),
  });
  const route = createBotLearningsRoutes({ enabled: true, learnings });
  const auth = (id: string) => ({ kind: "session", scopes: ["client"], session: { id, membershipAuthority: "team" } }) as unknown as RequestAuth;
  const call = async (id: string, method: string, suffix = "", body: unknown = {}) => {
    let answer: { status: number; body: any } | undefined;
    await route({ path: `/api/bots/a/learnings${suffix}`, method, auth: auth(id), req: {}, res: {},
      json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; },
      readBody: async () => typeof body === "function" ? await body() : body } as never);
    return answer!;
  };
  return { learnings, reviewers, call };
}
const item = { kind: "term", name: "Roadmap", detail: "Review Fridays" };

it("requires explicit sharing and manager review before the bot can read a proposed fact", async () => {
  const f = fixture();
  expect((await f.call("member", "POST", "", { explicitlyShared: false, learning: item })).status).toBe(400);
  expect((await f.call("member", "POST", "", { explicitlyShared: true, learning: { ...item, detail: "private data" } })).status).toBe(400);
  const proposed = await f.call("member", "POST", "", { explicitlyShared: true, learning: item });
  expect(proposed.status).toBe(201);
  expect(f.learnings.prompt("a")).toBe("");
  expect((await f.call("member", "GET")).status).toBe(404);
  const id = proposed.body.entry.id;
  expect((await f.call("manager", "PATCH", `/${id}`, { revision: 1, action: "accept" })).status).toBe(200);
  expect(f.learnings.prompt("a")).toContain("Review Fridays");
  f.learnings.close();
});

it("rechecks permission after reading the request body and never accepts a stale decision", async () => {
  const f = fixture();
  const proposed = await f.call("member", "POST", "", { explicitlyShared: true, learning: item });
  const path = `/${proposed.body.entry.id}`;
  const answer = await f.call("manager", "PATCH", path, () => { f.reviewers.delete("manager"); return { revision: 1, action: "accept" }; });
  expect(answer.status).toBe(404);
  expect(f.learnings.prompt("a")).toBe("");
  f.reviewers.add("manager");
  expect((await f.call("manager", "PATCH", path, { revision: 1, action: "reject" })).status).toBe(200);
  expect((await f.call("manager", "PATCH", path, { revision: 1, action: "accept" })).status).toBe(409);
  expect(f.learnings.prompt("a")).toBe("");
  f.learnings.close();
});
