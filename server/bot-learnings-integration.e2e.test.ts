import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchCloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("routes proposals to authorized reviewers and injects only accepted notes into the owning bot", async () => {
  const fixture = await launchCloudSendFixture({
    onePasswordToken: `ops_fake-learning-${randomBytes(8).toString("hex")}`,
    team: { id: "team-learning", name: "Example", engine: 'process.env.FAKE_CLAUDE_DUMP = process.env.FAKE_CLAUDE_FIXTURE_DIR + "/dump.json";' },
  });
  try {
    const team = fixture.team!;
    const owner = (await team.pair({ email: "owner@example.test", role: "owner" })).token!;
    const manager = (await team.pair({ email: "manager@example.test", role: "member" })).token!;
    const member = (await team.pair({ email: "member@example.test", role: "member" })).token!;
    const created = await team.as(owner, "POST", "/api/bots", { name: "Learning Scout" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string; mainThreadId?: string };
    const otherCreated = await team.as(owner, "POST", "/api/bots", { name: "Other Scout" });
    expect(otherCreated.status).toBe(201);
    const other = otherCreated.body.bot as { id: string };
    const path = `/api/bots/${bot.id}/learnings`;
    const capability = `/api/bots/${bot.id}/learning-capabilities`;
    expect((await team.as(member, "GET", capability)).body).toEqual({ canPropose: true, canReview: false });
    expect((await team.as(member, "GET", path)).status).toBe(404);
    const proposal = await team.as(member, "POST", path, { explicitlyShared: true, learning: { kind: "term", name: "Launch day", detail: "Tuesdays are launch day" } });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);
    const entry = proposal.body.entry as { id: string; revision: number };
    const preview = async (id: string) => JSON.stringify((await team.as(owner, "GET", `/api/bots/${id}/system-prompt`)).body);
    expect(await preview(bot.id)).not.toContain("Tuesdays are launch day");
    expect((await team.as(member, "PATCH", `${path}/${entry.id}`, { revision: entry.revision, action: "accept" })).status).toBe(404);
    const managers = await team.as(owner, "GET", `/api/bots/${bot.id}/managers`);
    expect(managers.status, JSON.stringify(managers.body)).toBe(200);
    const selected = managers.body.candidates.find((person: { email: string }) => person.email === "manager@example.test");
    expect(selected).toBeDefined();
    expect((await team.as(owner, "PUT", `/api/bots/${bot.id}/managers`, { members: [selected], expectedRevision: managers.body.revision })).status).toBe(200);
    expect((await team.as(manager, "GET", capability)).body).toEqual({ canPropose: true, canReview: true });
    expect((await team.as(manager, "PATCH", `${path}/${entry.id}`, { revision: entry.revision, action: "accept" })).status).toBe(200);
    expect((await team.as(manager, "PATCH", `${path}/${entry.id}`, { revision: entry.revision, action: "reject" })).status).toBe(409);
    expect(await preview(bot.id)).toContain("Tuesdays are launch day");
    expect(await preview(other.id)).not.toContain("Tuesdays are launch day");
    const secret = await team.as(member, "POST", path, { explicitlyShared: true, learning: { kind: "term", name: "Secret", detail: "Email person@example.com" } });
    expect(secret.status).toBe(400);

    const dumpPath = join(team.home, "dump.json");
    const turn = async (threadId: string, room?: string) => {
      rmSync(dumpPath, { force: true });
      const sent = await team.as(owner, "POST", room ? `/api/groups/${room}/messages` : `/api/bots/${bot.id}/messages`, { text: "@Learning Scout hello", threadId });
      expect(sent.status, JSON.stringify(sent.body)).toBe(202);
      await expect.poll(() => existsSync(dumpPath), { timeout: 30_000, interval: 100 }).toBe(true);
      const prompt = (JSON.parse(readFileSync(dumpPath, "utf8")) as { systemPrompt: string }).systemPrompt;
      await expect.poll(async () => ((await team.as(owner, "GET", "/api/bots")).body.bots as Array<{ busy?: boolean }>).every((item) => !item.busy), { timeout: 30_000, interval: 100 }).toBe(true);
      return prompt;
    };
    expect(await turn(bot.mainThreadId ?? bot.threadId)).toContain("Tuesdays are launch day");
    const room = await team.as(owner, "POST", "/api/groups", { name: "Learning Room", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    expect(await turn(room.body.group.threadId, room.body.group.id)).toContain("Tuesdays are launch day");

    expect((await team.signed("POST", "/api/cloud/team/member-left", { email: "manager@example.test" })).status).toBe(200);
    const returned = (await team.pair({ email: "manager@example.test", role: "member" })).token!;
    expect((await team.as(returned, "GET", capability)).body).toEqual({ canPropose: true, canReview: false });
  } finally {
    await fixture.close();
  }
}, hostTimeout(180_000));
