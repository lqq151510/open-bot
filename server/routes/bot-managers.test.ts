import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createBotManagers } from "../bot-managers.ts";
import type { RequestAuth } from "../request-auth.ts";
import { managerMembershipFixture } from "../testing/manager-membership-fixture.ts";
import { createBotManagersRoutes } from "./bot-managers.ts";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openbot-manager-routes-"));
  dirs.push(dir);
  const people = managerMembershipFixture();
  for (const [email, id, role] of [["owner@example.test", "owner", "member"], ["admin@example.test", "admin", "admin"], ["editor@example.test", "editor", "member"]] as const) people.seen(email, role, true, id);
  const bots = new Map([["bot-a", { id: "bot-a", reportsTo: "owner@example.test" }], ["bot-b", { id: "bot-b", reportsTo: "someone@example.test" }]]);
  const roles = new Map<string, "owner" | "admin" | "member">([["owner@example.test", "member"], ["admin@example.test", "admin"], ["editor@example.test", "member"]]);
  const managers = createBotManagers({ file: join(dir, "managers.json"), botGeneration: (id) => bots.has(id) ? "00000000-0000-4000-8000-000000000001" : null, membershipId: (email) => people.membershipId(email), isCurrentSession: (email, id) => people.isCurrentSession(email, id) });
  const route = createBotManagersRoutes({ enabled: true, bot: (id) => bots.get(id) as never, canSee: () => true, isCurrentSession: (email, id) => people.isCurrentSession(email, id), managers,
    currentTeamRole: (email) => roles.get(email) ?? null, candidates: () => people.managerCandidates() });
  const auth = (id: string, role: "member" | "admin" = "member", overrides: Record<string, unknown> = {}) => ({ kind: "session", scopes: role === "admin" ? ["admin", "client"] : ["client"], session: { id, email: `${id}@example.test`, teamRole: role, membershipAuthority: "team", ...overrides } }) as unknown as RequestAuth;
  const call = async (who: RequestAuth, method: string, bot: string, body: unknown = {}) => {
    let answer: { status: number; body: any } | undefined;
    await route({ path: `/api/bots/${bot}/managers`, method, auth: who, req: {}, res: {}, json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }, readBody: async () => typeof body === "function" ? await body() : body } as never);
    return answer!;
  };
  return { people, bots, roles, managers, auth, call };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("only a verified team admin or bot owner can manage that bot's managers", async () => {
  const { people, managers, auth, call } = fixture();
  const owner = auth("admin", "admin");
  const listed = await call(owner, "GET", "bot-a");
  expect(listed.status).toBe(200);
  const member = { email: "editor@example.test", membershipId: people.membershipId("editor@example.test") };
  const saved = await call(owner, "PUT", "bot-a", { members: [member], expectedRevision: listed.body.revision });
  expect(saved.status).toBe(200);
  expect(managers.has("bot-a", member.email, "editor")).toBe(true);
  expect((await call(auth("editor"), "GET", "bot-a")).status).toBe(404);
  expect((await call(auth("owner"), "GET", "bot-a")).status).toBe(200);
  expect((await call(auth("owner"), "GET", "bot-b")).status).toBe(404);
  expect((await call(auth("admin", "admin"), "GET", "bot-b")).status).toBe(200);
});

it("rejects unsigned, move-in, role-spoofed and revoked sessions", async () => {
  const { people, auth, call } = fixture();
  expect((await call(auth("owner", "member", { membershipAuthority: undefined }), "GET", "bot-a")).status).toBe(404);
  expect((await call(auth("admin", "admin", { moveIn: "bot-a" }), "GET", "bot-a")).status).toBe(404);
  expect((await call(auth("editor", "admin", { teamRole: "member" }), "GET", "bot-a")).status).toBe(404);
  people.left("owner@example.test");
  people.seen("owner@example.test", "member", true, "new-owner");
  expect((await call(auth("owner"), "GET", "bot-a")).status).toBe(404);
});

it("rejects an old admin session after its member is demoted", async () => {
  const { roles, auth, call } = fixture();
  const admin = auth("admin", "admin");
  const listed = await call(admin, "GET", "bot-a");
  expect(listed.status).toBe(200);
  roles.set("admin@example.test", "member");
  expect((await call(admin, "GET", "bot-a")).status).toBe(404);
  expect((await call(admin, "PUT", "bot-a", { members: [], expectedRevision: listed.body.revision })).status).toBe(404);
  roles.set("admin@example.test", "admin");
  const duringRead = await call(admin, "PUT", "bot-a", () => {
    roles.set("admin@example.test", "member");
    return { members: [], expectedRevision: listed.body.revision };
  });
  expect(duringRead.status).toBe(404);
});

it("rejects a stale selection after the chosen member leaves and rejoins", async () => {
  const { people, auth, call } = fixture();
  const owner = auth("admin", "admin");
  const listed = await call(owner, "GET", "bot-a");
  const candidate = listed.body.candidates.find((person: { email: string }) => person.email === "editor@example.test");
  people.left("editor@example.test");
  people.seen("editor@example.test", "member", true, "editor-new");
  const response = await call(owner, "PUT", "bot-a", { members: [candidate], expectedRevision: listed.body.revision });
  expect(response.status).toBe(400);
});
