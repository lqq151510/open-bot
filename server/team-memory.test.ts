import { mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TeamMemory, TeamMemoryConflict, TEAM_MEMORY_PROMPT_MAX_BYTES } from "./team-memory.ts";
import { createTeamMemoryRequests } from "./team-memory-requests.ts";
import { appendTeamMemoryReview, readDecisions, withDecisionActor } from "./decision-log.ts";
import { teamMemoryAuditActor } from "./team-memory-audit-actor.ts";
import { ensureSections, changeEmptySection, sectionMemoryKey, SECTION_CONTEXTS_FILE } from "./section-context.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let dir: string;
let memory: TeamMemory;
const source = { botId: "b1", botName: "Scout", threadId: "t1", at: 1_757_000_000_000 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-team-memory-"));
  memory = new TeamMemory(join(dir, "team-memory.json"));
});

afterEach(async () => {
  await removeTempDir(dir);
});

it.each([
  { requireReview: true, state: "pending", status: "proposed" },
  { requireReview: false, state: "applied", status: "accepted" },
])("shared memory respects review policy: $state", ({ requireReview, state, status }) => {
  const cards: Array<{ card: { autoApplied?: boolean } }> = [];
  const requests = createTeamMemoryRequests({
    teamMemory: memory,
    requireReview,
    sectionKey: (section) => section ?? "",
    decide: () => {},
    store: {
      messagesFor: () => [],
      appendMessage: (_threadId, message) => { cards.push(message); return { id: "message" }; },
      patchMessage: () => {},
      bot: () => null,
      botByThread: () => ({ id: "b", name: "Bot" }),
    },
  });
  const result = requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
    { kind: "decision", name: "Colour", detail: "Use amber" }, "full-access");
  expect(result.body.state).toBe(state);
  expect(memory.list("")[0]?.status).toBe(status);
  expect(memory.systemPrompt("")).toEqual(requireReview ? "" : expect.stringContaining("Use amber"));
  expect(cards[0]?.card.autoApplied).toBe(requireReview ? undefined : true);
  if (requireReview) {
    const entry = memory.list("")[0]!;
    memory.resolve("", entry.id, "accept", entry.revision);
    expect(memory.systemPrompt("")).toContain("Use amber");
    requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
      { kind: "decision", name: "Meeting", detail: "Use violet" }, "full-access");
    const rejected = memory.list("").find((candidate) => candidate.name === "Meeting")!;
    memory.resolve("", rejected.id, "reject", rejected.revision);
    expect(memory.systemPrompt("")).not.toContain("Use violet");
  }
});

it("recovers reviewed cards from durable receipts after a failed patch and restart", () => {
  let message: any;
  let failPatch = true;
  const store = {
    messagesFor: () => message ? [message] : [],
    appendMessage: (_thread: string, value: any) => (message = { id: "m", ...value }),
    patchMessage: (_thread: string, _id: string, patch: any) => {
      if (failPatch) throw new Error("storage unavailable");
      Object.assign(message, patch);
    },
    bot: () => null,
    botByThread: () => ({ id: "b", name: "Bot" }),
  };
  const create = (teamMemory: TeamMemory) => createTeamMemoryRequests({
    teamMemory, store, requireReview: true, sectionKey: (section) => section ?? "", decide: () => {}, threadExists: () => true,
  });
  const requests = create(memory);
  const submitted = requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
    { kind: "decision", name: "Colour", detail: "Use amber" }, "full-access");
  const proposal = memory.list("").find(entry => entry.id === submitted.body.requestId)!;
  memory.update("", proposal.id, { detail: "Use blue" }, proposal.revision);
  expect(requests.reconcile()).toBe(1);
  expect(message.card.answered).toBeUndefined();
  failPatch = false;
  const restarted = create(new TeamMemory(join(dir, "team-memory.json")));
  expect(restarted.reconcile()).toBe(0);
  expect(message.card).toMatchObject({ answered: "allow", subtitle: "Decision: Colour — Use blue" });
  expect(restarted.reconcile()).toBe(0);
});

it("rejects imported ids already held by another department", () => {
  ensureSections(["Import target"]);
  const existing = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "thread", at: 1 }).entry;
  expect(memory.adopt("Import target", [existing])).toBe(0);
  expect(memory.list("Import target")).toEqual([]);
});

it("recognizes a native entry on return while rejecting changed content or source", () => {
  const original = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "native-thread", at: 1 }).entry;
  const conflicts: string[] = [];
  expect(memory.adopt("", [original], id => conflicts.push(id))).toBe(0);
  expect(conflicts).toEqual([]);
  expect(memory.adopt("", [{ ...original, detail: "Blue" },
    { ...original, source: { ...original.source, threadId: "another-thread" } }], id => conflicts.push(id))).toBe(0);
  expect(conflicts).toEqual([original.id, original.id]);
  memory.resolve("", original.id, "accept", original.revision);
  expect(memory.adopt("", [original], id => conflicts.push(id))).toBe(0);
  expect(conflicts).toEqual([original.id, original.id, original.id]);
  expect(memory.adopt("", [memory.list("")[0]!], id => conflicts.push(id))).toBe(0);
  expect(conflicts).toEqual([original.id, original.id, original.id]);
  expect(memory.list("")[0]!.detail).toBe("Amber");
});

it("retains a pending proposal's untrusted thread hint through chained migrations", () => {
  const source = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "remote-thread", at: 1 }).entry;
  const middle = new TeamMemory(join(dir, "middle.json"));
  const destination = new TeamMemory(join(dir, "destination.json"));
  expect(middle.adopt("", [source])).toBe(1);
  expect(destination.adopt("", middle.list(""))).toBe(1);
  const incoming = destination.list("")[0]!;
  expect(incoming.source.threadId).toBe("");
  expect(destination.untrustedProposal(incoming.id)).toEqual({ threadId: "remote-thread", botId: "b" });
  const message: any = { id: "m", card: { requestId: incoming.id, teamMemoryRequest: { entryId: incoming.id, section: "" } } };
  const requests = createTeamMemoryRequests({
    teamMemory: destination, requireReview: true, sectionKey: (section) => section ?? "", decide: () => {}, threadExists: () => true,
    store: { messagesFor: () => [message], appendMessage: () => ({ id: "m" }),
      patchMessage: (_thread, _id, patch) => Object.assign(message, patch),
      bot: () => null, botByThread: () => ({ id: "b", name: "Bot" }) },
  });
  expect(requests.resolve("remote-thread", incoming.id, "allow")).toMatchObject({ outcome: "allowed-once" });
  expect(message.card.answered).toBe("allow");
});

it("does not import another workspace's review projection or thread target", () => {
  const entry = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "remote-thread", at: 1 }).entry;
  memory.resolve("", entry.id, "accept", entry.revision);
  const source = memory.list("", true)[0]!;
  const other = new TeamMemory(join(dir, "other-team-memory.json"));
  expect(other.adopt("", [source])).toBe(1);
  expect(other.reviewReceipts()).toEqual([]);
  expect(other.list("")[0]!.source.threadId).toBe("");

  const pending = memory.propose("", { kind: "decision", name: "Shape", detail: "Round" },
    { botId: "b", botName: "Bot", threadId: "remote-thread", at: 2 }).entry;
  expect(other.adopt("", [pending])).toBe(1);
  const imported = other.list("").find(candidate => candidate.id === pending.id)!;
  other.resolve("", imported.id, "accept", imported.revision);
  expect(other.reviewReceipts()).toMatchObject([{ entryId: imported.id, threadId: "remote-thread", untrusted: true }]);
});

it.each(["list", "card"] as const)("reconciles a migrated proposal through a locally verified %s review", (method) => {
  const source = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "remote-thread", at: 1 }).entry;
  const other = new TeamMemory(join(dir, "imported-team-memory.json"));
  other.adopt("", [source]);
  const imported = other.list("")[0]!;
  const message: any = { id: "m", card: { requestId: imported.id, teamMemoryRequest: { entryId: imported.id, section: "" } } };
  let localBot = "other-bot";
  const requests = createTeamMemoryRequests({
    teamMemory: other, requireReview: true, sectionKey: (section) => section ?? "", decide: () => {}, threadExists: () => true,
    store: { messagesFor: () => [message], appendMessage: () => ({ id: "m" }),
      patchMessage: (_thread, _id, patch) => Object.assign(message, patch),
      bot: () => null, botByThread: () => ({ id: localBot, name: "Bot" }) },
  });
  if (method === "card") {
    expect(requests.resolve("remote-thread", imported.id, "allow")).toBeNull();
    expect(other.list("")[0]!.status).toBe("proposed");
    localBot = "b";
    expect(requests.resolve("remote-thread", imported.id, "allow")).toMatchObject({ outcome: "allowed-once" });
  } else {
    other.resolve("", imported.id, "accept", imported.revision);
    requests.reconcile();
    expect(message.card.answered).toBeUndefined();
    localBot = "b";
    requests.reconcile();
  }
  expect(message.card).toMatchObject({ answered: "allow", subtitle: "Decision: Colour — Amber" });
});

it("does not attribute a replayed review to the person handling another proposal", () => {
  const messages: any[] = [];
  let failFirst = true;
  let failAudit = true;
  const requests = createTeamMemoryRequests({
    teamMemory: memory, requireReview: true, sectionKey: (section) => section ?? "", threadExists: () => true,
    decide: () => {},
    audit: (id, row) => { if (failAudit) throw new Error("audit unavailable"); appendTeamMemoryReview(dir, id, row); },
    store: {
      messagesFor: () => messages,
      appendMessage: (_thread, value) => { const message = { id: String(messages.length), ...value }; messages.push(message); return message; },
      patchMessage: (_thread, id, patch) => {
        if (id === "0" && failFirst) throw new Error("card unavailable");
        Object.assign(messages[Number(id)], patch);
      },
      bot: () => null, botByThread: () => ({ id: "b", name: "Bot" }),
    },
  });
  const first = requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
    { kind: "decision", name: "First", detail: "Amber" }, null);
  const second = requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
    { kind: "decision", name: "Second", detail: "Blue" }, null);
  const firstActor = { kind: "session" as const, sessionId: "first", label: "First", email: "first@example.test" };
  const secondActor = { kind: "session" as const, sessionId: "second", label: "Second" };
  expect(withDecisionActor(firstActor, () => requests.resolve("thread", first.body.requestId!, "allow"))?.outcome).toBe("allowed-once");
  failFirst = false;
  failAudit = false;
  expect(withDecisionActor(secondActor, () => requests.resolve("thread", second.body.requestId!, "deny"))?.outcome).toBe("rejected");
  requests.reconcile();
  expect(messages.map(message => message.card.answered)).toEqual(["allow", "deny"]);
  const decisions = readDecisions(dir, 20).filter(row => row.decision === "user-approved" || row.decision === "user-denied");
  expect(decisions).toHaveLength(2);
  expect(decisions.find(row => row.requestId === first.body.requestId)?.actor).toEqual(teamMemoryAuditActor(firstActor));
  expect(decisions.find(row => row.requestId === second.body.requestId)?.actor).toEqual(teamMemoryAuditActor(secondActor));
});

it("rejects forged cards, wrong sections and another private chat of the same bot", () => {
  const messages = new Map<string, any[]>();
  const requests = createTeamMemoryRequests({
    teamMemory: memory, requireReview: true, sectionKey: (section) => section ?? "", threadExists: () => true, decide: () => {},
    store: {
      messagesFor: (thread) => messages.get(thread) ?? [],
      appendMessage: (thread, value) => {
        const message = { id: "m", ...value };
        messages.set(thread, [message]);
        return message;
      },
      patchMessage: (thread, _id, patch) => Object.assign(messages.get(thread)![0], patch),
      bot: () => null, botByThread: () => ({ id: "b", name: "Bot" }),
    },
  });
  const author = { id: "b", name: "Bot", color: "blue" };
  const a = requests.submit(author, "first", false, { kind: "decision", name: "First", detail: "Amber" }, null);
  const b = requests.submit(author, "second", false, { kind: "decision", name: "Second", detail: "Blue" }, null);
  const first = messages.get("first")![0];
  first.card.teamMemoryRequest.entryId = b.body.requestId;
  expect(requests.resolve("first", a.body.requestId!, "allow")).toBeNull();
  first.card.requestId = b.body.requestId;
  expect(requests.resolve("first", b.body.requestId!, "allow")).toBeNull();
  const second = messages.get("second")![0];
  second.card.teamMemoryRequest.section = "wrong";
  expect(requests.resolve("second", b.body.requestId!, "allow")).toBeNull();
  expect(memory.list("").map(entry => entry.status)).toEqual(["proposed", "proposed"]);
  second.card.teamMemoryRequest.section = "";
  expect(requests.resolve("second", b.body.requestId!, "allow")).toMatchObject({ outcome: "allowed-once" });
});

it("keeps a legitimate card bound after its department is renamed", () => {
  ensureSections(["Review original"]);
  const proposal = memory.propose("Review original", { kind: "decision", name: "Colour", detail: "Amber" },
    { botId: "b", botName: "Bot", threadId: "thread", cardSection: "Review original", at: 1 }).entry;
  changeEmptySection("Review original", "Review renamed");
  expect(memory.matchesCard(proposal.id, "Review original", "thread", "b")).toBe(true);
  expect(memory.matchesCard(proposal.id, "Review renamed", "thread", "b")).toBe(false);
  expect(memory.resolveProposal(proposal.id, "accept")).toMatchObject({ state: "accepted" });
});

it("accepts the original bot's card in a shared room", () => {
  let message: any;
  const requests = createTeamMemoryRequests({
    teamMemory: memory, requireReview: true, sectionKey: (section) => section ?? "", decide: () => {},
    store: {
      messagesFor: () => message ? [message] : [],
      appendMessage: (_thread, value) => (message = { id: "m", ...value }),
      patchMessage: (_thread, _id, patch) => Object.assign(message, patch),
      bot: () => null, botByThread: () => null,
    },
  });
  const submitted = requests.submit({ id: "b", name: "Bot", color: "blue" }, "room", true,
    { kind: "decision", name: "Colour", detail: "Amber" }, null);
  expect(requests.resolve("room", submitted.body.requestId!, "allow")).toMatchObject({ outcome: "allowed-once" });
  expect(message.card.answered).toBe("allow");
});

it("keeps a rejected review when card and decision writes fail", () => {
  let message: any;
  let failPatch = true;
  let decisions = 0;
  const requests = createTeamMemoryRequests({
    teamMemory: memory, requireReview: true, sectionKey: (section) => section ?? "", threadExists: () => true,
    decide: () => { if (++decisions > 1) throw new Error("audit unavailable"); },
    store: {
      messagesFor: () => message ? [message] : [],
      appendMessage: (_thread, value) => (message = { id: "m", ...value }),
      patchMessage: (_thread, _id, patch) => { if (failPatch) throw new Error("card unavailable"); Object.assign(message, patch); },
      bot: () => null, botByThread: () => ({ id: "b", name: "Bot" }),
    },
  });
  const submitted = requests.submit({ id: "b", name: "Bot", color: "blue" }, "thread", false,
    { kind: "decision", name: "Colour", detail: "Use amber" }, null);
  expect(requests.resolve("thread", submitted.body.requestId!, "deny")).toMatchObject({ ok: true, outcome: "rejected" });
  expect(memory.list("")).toHaveLength(0);
  failPatch = false;
  expect(requests.resolve("thread", submitted.body.requestId!, "allow")).toMatchObject({ ok: true, outcome: "rejected", alreadySettled: true });
  expect(message.card.answered).toBe("deny");
});

it("keeps a rejected receipt after deletion and does not open deleted conversations", () => {
  const entry = memory.propose("", { kind: "decision", name: "Colour", detail: "Use amber" },
    { botId: "b", botName: "Bot", threadId: "gone", at: 1 }).entry;
  memory.remove("", entry.id, entry.revision);
  const restored = new TeamMemory(join(dir, "team-memory.json"));
  expect(restored.reviewReceipts()).toMatchObject([{ entryId: entry.id, answer: "deny" }]);
  const requests = createTeamMemoryRequests({
    teamMemory: restored, requireReview: true, sectionKey: (section) => section ?? "", decide: () => {},
    threadExists: () => false,
    store: { messagesFor: () => { throw new Error("must not reopen"); }, appendMessage: () => ({ id: "m" }),
      patchMessage: () => {}, bot: () => null, botByThread: () => ({ id: "b", name: "Bot" }) },
  });
  expect(requests.reconcile()).toBe(0);
});

describe("propose", () => {
  it.each(["{broken", '{"version":1,"sections":{"Team":[{"invalid":true}]}}'])("preserves an unreadable existing file instead of replacing it: %s", (bytes) => {
    const file = join(dir, "team-memory.json");
    writeFileSync(file, bytes);
    const reopened = new TeamMemory(file);
    expect(reopened.list("")).toEqual([]);
    expect(() => reopened.propose("", { kind: "term", name: "new", detail: "cannot overwrite" }, source)).toThrow(/could not be read/);
    expect(reopened.list("")).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(bytes);
  });

  it.each(["constructor", "__proto__"])("keeps prototype-like section names through updates, rollback and restart: %s", (section) => {
    expect(memory.list(section)).toEqual([]);
    const first = memory.propose(section, { kind: "term", name: "OMB", detail: "original" }, source);
    const file = join(dir, "team-memory.json");
    memory = new TeamMemory(file);
    expect(memory.list(section)[0].detail).toBe("original");
    expect(memory.update(section, first.entry.id, { detail: "updated" })?.detail).toBe("updated");
    expect(new TeamMemory(file).list(section)[0].detail).toBe("updated");
    renameSync(file, file + ".saved");
    mkdirSync(file);
    expect(() => memory.update(section, first.entry.id, { detail: "lost" })).toThrow();
    expect(memory.list(section)[0].detail).toBe("updated");
    expect(memory.list("")).toEqual([]);
  });

  it("keeps an approved person unchanged until the replacement is approved", () => {
    const first = memory.propose("", { kind: "person", name: "Alex", detail: "original" }, source);
    memory.resolve("", first.entry.id, "accept");
    const replacement = memory.propose("", { kind: "person", name: "Alex", detail: "replacement" }, { ...source, at: source.at + 1 });
    expect(replacement.status).toBe("proposed");
    expect(replacement.entry.id).not.toBe(first.entry.id);
    expect(memory.systemPrompt("")).toContain("Alex: original");
    expect(memory.systemPrompt("")).not.toContain("replacement");
    expect(new TeamMemory(join(dir, "team-memory.json")).systemPrompt("")).toContain("Alex: original");
    memory.resolve("", replacement.entry.id, "accept");
    expect(memory.systemPrompt("")).toContain("Alex: replacement");
    expect(memory.list("").filter(entry => entry.status === "accepted")).toHaveLength(1);
  });

  it("masks a secret a bot put into an entry before it is stored or shown", () => {
    const key = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0".repeat(3);
    const proposed = memory.propose("", { kind: "place", name: "Billing API", detail: `the key is ${key}`, aliases: [] }, source);
    expect(proposed.entry.detail).not.toContain(key);
    expect(readFileSync(join(dir, "team-memory.json"), "utf8")).not.toContain(key);
  });

  it("rejects aliases that would make persisted entries unreadable", () => {
    expect(() => memory.propose("", { kind: "term", name: "OMB", detail: "app", aliases: ["x".repeat(121)] }, source)).toThrow(/aliases/);
    expect(memory.list("")).toEqual([]);
  });

  it("rolls memory back when a mutation cannot be saved", () => {
    const first = memory.propose("", { kind: "term", name: "OMB", detail: "original" }, source);
    const file = join(dir, "team-memory.json");
    renameSync(file, file + ".saved");
    mkdirSync(file);
    expect(() => memory.update("", first.entry.id, { detail: "lost" })).toThrow();
    expect(memory.list("")[0].detail).toBe("original");
    expect(() => memory.propose("", { kind: "term", name: "new", detail: "lost" }, source)).toThrow();
    expect(memory.list("")).toHaveLength(1);
    expect(() => memory.remove("", first.entry.id)).toThrow();
    expect(memory.list("")).toHaveLength(1);
  });
  it("holds every kind outside shared prompts until reviewed", () => {
    const place = memory.propose("", { kind: "place", name: "Launch plan", detail: "Notion page in the Marketing space" }, source);
    expect(place.status).toBe("proposed");
    const term = memory.propose("", { kind: "term", name: "MCHQ", detail: "MissionControlHQ, our old name" }, source);
    expect(term.status).toBe("proposed");
    const person = memory.propose("", { kind: "person", name: "Ayush", detail: "Founder, handles sales", aliases: ["Ayu"] }, source);
    expect(person.status).toBe("proposed");
    const decision = memory.propose("", { kind: "decision", name: "Ship Android first", detail: "Decided in the Monday sync" }, source);
    expect(decision.status).toBe("proposed");
    expect(memory.list("").map((entry) => [entry.name, entry.status])).toEqual([
      ["Launch plan", "proposed"],
      ["MCHQ", "proposed"],
      ["Ayush", "proposed"],
      ["Ship Android first", "proposed"],
    ]);
    expect(memory.systemPrompt("")).toBe("");
    memory.resolve("", term.entry.id, "accept");
    expect(memory.systemPrompt("")).toContain("MCHQ");
    expect(memory.systemPrompt("")).not.toContain("Launch plan");
  });

  it("keeps accepted terms and places until their selected replacement is reviewed", () => {
    const first = memory.propose("", { kind: "place", name: "Launch plan", detail: "old page" }, source);
    memory.resolve("", first.entry.id, "accept");
    const again = memory.propose("", { kind: "place", name: "launch plan", detail: "new page" }, source);
    expect(again.status).toBe("proposed");
    const other = memory.propose("", { kind: "place", name: "launch plan", detail: "another pending revision" }, source);
    expect(memory.systemPrompt("")).toContain("old page");
    expect(memory.systemPrompt("")).not.toContain("new page");
    memory.resolve("", other.entry.id, "reject");
    memory.resolve("", again.entry.id, "accept");
    expect(memory.list("")).toHaveLength(1);
    expect(memory.list("")[0].detail).toBe("new page");
  });

  it("keeps sections apart, and records who said it", () => {
    memory.propose("Work", { kind: "term", name: "OKR", detail: "quarterly goals" }, source);
    expect(memory.list("")).toEqual([]);
    expect(memory.list("Work")[0].source).toEqual(source);
  });

  it("refuses junk", () => {
    expect(() => memory.propose("", { kind: "person", name: "", detail: "x" }, source)).toThrow(/name/);
    expect(() => memory.propose("", { kind: "rumor" as never, name: "x", detail: "x" }, source)).toThrow(/kind/);
    expect(() => memory.propose("", { kind: "term", name: "x".repeat(200), detail: "x" }, source)).toThrow(/name/);
  });
});

describe("undoAccept", () => {
  it("removes an addition that applied on its own and brings back the fact it replaced, once", () => {
    const original = memory.propose("", { kind: "person", name: "Alex", detail: "original" }, source).entry;
    memory.resolve("", original.id, "accept");
    const replacement = memory.propose("", { kind: "person", name: "Alex", detail: "replacement" }, source).entry;
    memory.resolve("", replacement.id, "accept");
    const revision = memory.list("").find((entry) => entry.id === replacement.id)!.revision!;
    expect(memory.undoAccept("", replacement.id, revision)).toBe(true);
    expect(memory.list("").map((entry) => [entry.detail, entry.status])).toEqual([["original", "accepted"]]);
    expect(memory.undoAccept("", replacement.id, revision)).toBe(false);
  });

  it("changes nothing once the entry was edited since", () => {
    const added = memory.propose("", { kind: "term", name: "OMB", detail: "first" }, source).entry;
    memory.resolve("", added.id, "accept");
    const revision = memory.list("")[0]!.revision!;
    memory.update("", added.id, { detail: "a person's edit" });
    expect(memory.undoAccept("", added.id, revision)).toBe(false);
    expect(memory.list("")[0]).toMatchObject({ detail: "a person's edit", status: "accepted" });
  });
});

describe("resolve, update, remove", () => {
  it("rejects edits that collide with another accepted fact", () => {
    const a = memory.propose("", { kind: "term", name: "Alex", detail: "term" }, source);
    const place = memory.propose("", { kind: "place", name: "Alex", detail: "place" }, source);
    memory.resolve("", place.entry.id, "accept");
    expect(() => memory.update("", a.entry.id, { kind: "place" })).toThrow(/already exists/);
    expect(memory.list("")[0].kind).toBe("term");
  });
  it("accepts or drops a proposal exactly once", () => {
    const { entry } = memory.propose("", { kind: "person", name: "Bhanu", detail: "CTO" }, source);
    expect(memory.resolve("", entry.id, "accept")).toEqual({ claimed: true, state: "accepted" });
    expect(memory.list("")[0].status).toBe("accepted");
    expect(memory.resolve("", entry.id, "accept")).toEqual({ claimed: true, state: "already_settled" });
    const { entry: dropped } = memory.propose("", { kind: "decision", name: "Drop Telegram", detail: "not our surface" }, source);
    expect(memory.resolve("", dropped.id, "reject")).toEqual({ claimed: true, state: "rejected" });
    expect(memory.list("").some((candidate) => candidate.id === dropped.id)).toBe(false);
    expect(memory.resolve("", "nope", "accept")).toEqual({ claimed: false });
  });

  it("lets the person edit and delete, and keeps the file private", () => {
    const { entry } = memory.propose("", { kind: "term", name: "OMB", detail: "OpenBot" }, source);
    const edited = memory.update("", entry.id, { detail: "OpenBot, the app", aliases: ["OpenMaus"] });
    expect(edited?.detail).toBe("OpenBot, the app");
    expect(edited?.aliases).toEqual(["OpenMaus"]);
    expect(memory.remove("", entry.id)).toBe(true);
    expect(memory.remove("", entry.id)).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(dir, "team-memory.json")).mode & 0o777).toBe(0o600);
  });

  it("survives a restart", () => {
    memory.propose("", { kind: "term", name: "OMB", detail: "OpenBot" }, source);
    const reopened = new TeamMemory(join(dir, "team-memory.json"));
    expect(reopened.list("")).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "team-memory.json"), "utf8")).version).toBe(2);
  });
});

describe("systemPrompt", () => {
  it("is empty with nothing accepted, and lists accepted entries by kind otherwise", () => {
    expect(memory.systemPrompt("")).toBe("");
    const term = memory.propose("", { kind: "term", name: "MCHQ", detail: "MissionControlHQ" }, source);
    const place = memory.propose("", { kind: "place", name: "Launch plan", detail: "Notion, Marketing space" }, source);
    const { entry } = memory.propose("", { kind: "person", name: "Ayush", detail: "Founder", aliases: ["Ayu"] }, source);
    memory.propose("", { kind: "decision", name: "Ship Android first", detail: "Monday sync" }, source);
    const beforeAccept = memory.systemPrompt("");
    expect(beforeAccept).not.toContain("Ayush");
    expect(beforeAccept).toBe("");
    memory.resolve("", term.entry.id, "accept");
    memory.resolve("", place.entry.id, "accept");
    memory.resolve("", entry.id, "accept");
    const prompt = memory.systemPrompt("");
    expect(prompt).toContain("Ayush (also: Ayu): Founder");
    expect(prompt).toContain("MCHQ: MissionControlHQ");
    expect(prompt).toContain("Launch plan: Notion, Marketing space");
    expect(prompt).not.toContain("Ship Android first");
    expect(prompt).toContain("propose_team_memory");
  });

  it("stays under its byte budget, newest first when it has to cut", () => {
    // 400 accepted terms written as one saved file: accepting each in turn was 800 saves, past the Windows runners' timeout.
    const entries = Array.from({ length: 400 }, (_, i) => ({
      id: `term-${i}`, kind: "term", name: `Term ${i}`, detail: "d".repeat(60), aliases: [], status: "accepted",
      source: { ...source, at: source.at + i }, updatedAt: source.at + i,
    }));
    writeFileSync(join(dir, "team-memory.json"), JSON.stringify({ version: 1, sections: { "": entries } }));
    const prompt = new TeamMemory(join(dir, "team-memory.json")).systemPrompt("");
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(TEAM_MEMORY_PROMPT_MAX_BYTES + 400);
    expect(prompt).toContain("Term 399");
    expect(prompt).not.toContain("Term 0:");
  });
});

it("keeps memory and pending cards through rename, but never reuses a deleted identity", () => {
  ensureSections(["Memory editing"]);
  const originalKey = sectionMemoryKey("Memory editing");
  const { entry } = memory.propose("Memory editing", { kind: "decision", name: "Colour", detail: "Amber" }, source);
  changeEmptySection("Memory editing", "Memory post");
  expect(sectionMemoryKey("Memory post")).toBe(originalKey);
  expect(memory.resolveProposal(entry.id, "accept")).toMatchObject({ state: "accepted" });
  expect(memory.systemPrompt("Memory post")).toContain("Amber");
  ensureSections(["Memory editing"]);
  expect(memory.list("Memory editing")).toEqual([]);
  changeEmptySection("Memory post", null);
  ensureSections(["Memory post"]);
  expect(memory.list("Memory post")).toEqual([]);
  expect(new TeamMemory(join(dir, "team-memory.json")).list("Memory post")).toEqual([]);
});

it("rejects stale edits, deletion and pending replacements while retaining the old text", () => {
  const { entry } = memory.propose("", { kind: "decision", name: "Colour", detail: "Blue", key: "tapa/colour" }, source);
  memory.resolve("", entry.id, "accept");
  const old = memory.list("")[0];
  const next = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber", key: "tapa/colour" }, source);
  memory.update("", old.id, { detail: "Green" }, old.revision);
  expect(() => memory.update("", old.id, { detail: "Stale" }, old.revision)).toThrow(TeamMemoryConflict);
  expect(() => memory.remove("", old.id, old.revision)).toThrow(TeamMemoryConflict);
  expect(() => memory.resolve("", next.entry.id, "accept")).toThrow(TeamMemoryConflict);
  expect(memory.list("")[0].history?.[0].detail).toBe("Blue");
  expect(new TeamMemoryConflict()).toMatchObject({ message: "This department memory changed. Reload it before saving or approving.", errorKey: "serverError.department.memoryChanged" });
  expect(new TeamMemoryConflict("Another wording")).not.toHaveProperty("errorKey");
});

it("replaces a keyed decision even when its name changes and preserves its history", () => {
  const first = memory.propose("", { kind: "decision", name: "Blue treatment", detail: "Use blue", key: "tapa/colour" }, source);
  memory.resolve("", first.entry.id, "accept");
  const second = memory.propose("", { kind: "decision", name: "Orange approved", detail: "Use orange", key: "tapa/colour" }, source);
  memory.resolve("", second.entry.id, "accept");
  expect(memory.search("", "blue")).toEqual([]);
  expect(memory.list("")).toHaveLength(1);
  expect(memory.list("")[0].history?.[0].detail).toBe("Use blue");
  expect(memory.list("", true).find(entry => entry.id === first.entry.id)?.status).toBe("superseded");
});

it("keeps pending replacement revisions valid through a server restart", () => {
  const first = memory.propose("", { kind: "decision", name: "Colour", detail: "Blue" }, source);
  memory.resolve("", first.entry.id, "accept");
  const replacement = memory.propose("", { kind: "decision", name: "Colour", detail: "Amber" }, source);
  const reopened = new TeamMemory(join(dir, "team-memory.json"));
  expect(reopened.resolve("", replacement.entry.id, "accept")).toMatchObject({ state: "accepted" });
  expect(reopened.list("")[0].detail).toBe("Amber");
});

it("discloses omitted notes, keeps pinned rules first and searches every accepted entry", () => {
  for (let i = 0; i < 20; i++) {
    const { entry } = memory.propose("", { kind: "term", name: `Rule ${i}`, detail: `${i === 0 ? "critical " : ""}${"x".repeat(550)}` }, { ...source, at: i });
    memory.resolve("", entry.id, "accept");
  }
  const old = memory.list("")[0];
  memory.update("", old.id, { pinned: true }, old.revision);
  const selection = memory.promptSelection("");
  expect(selection.loadedIds).toContain(old.id);
  expect(selection.loadedIds.length).toBeLessThan(selection.total);
  expect(selection.text).toContain("Some notes are not loaded");
  expect(Buffer.byteLength(selection.text)).toBeLessThanOrEqual(TEAM_MEMORY_PROMPT_MAX_BYTES);
  expect(memory.search("", "Rule 1", 25).length).toBeGreaterThan(0);
});

it("fails closed on unreadable team ownership without blocking prompt construction", () => {
  ensureSections(["Broken registry team"]);
  const { entry } = memory.propose("Broken registry team", { kind: "term", name: "Private", detail: "Do not guess ownership" }, source);
  memory.resolve("Broken registry team", entry.id, "accept");
  const original = readFileSync(SECTION_CONTEXTS_FILE, "utf8");
  try {
    writeFileSync(SECTION_CONTEXTS_FILE, "{broken");
    expect(memory.systemPrompt("Broken registry team")).toBe("");
    expect(() => memory.propose("Broken registry team", { kind: "term", name: "Lost", detail: "must not save" }, source)).toThrow(/could not be read/);
  } finally { writeFileSync(SECTION_CONTEXTS_FILE, original); }
  expect(memory.list("Broken registry team")[0].name).toBe("Private");
});


it("rejects duplicate accepted names under distinct keys without settling the proposal", () => {
  const first = memory.propose("", { kind: "decision", name: "Colour", detail: "Blue", key: "project/one" }, source).entry;
  memory.resolve("", first.id, "accept");
  const second = memory.propose("", { kind: "decision", name: "Colour", detail: "Orange", key: "project/two" }, source).entry;
  expect(() => memory.resolve("", second.id, "accept")).toThrow(/another key/);
  expect(memory.list("").find(entry => entry.id === second.id)?.status).toBe("proposed");
  expect(memory.list("").filter(entry => entry.status === "accepted")).toHaveLength(1);
});

it("accepts an edited pending replacement while preserving the accepted and proposed versions", () => {
  const first = memory.propose("", { kind: "decision", name: "Colour", detail: "Blue", key: "project/colour" }, source).entry;
  memory.resolve("", first.id, "accept");
  const second = memory.propose("", { kind: "decision", name: "Colour", detail: "Orange", key: "project/colour" }, source).entry;
  const edited = memory.update("", second.id, { detail: "Amber" }, second.revision)!;
  expect(edited.status).toBe("accepted");
  expect(edited.history?.map(version => version.detail)).toEqual(expect.arrayContaining(["Blue", "Orange"]));
  expect(memory.list("").filter(entry => entry.status === "accepted").map(entry => entry.detail)).toEqual(["Amber"]);
  const stale = memory.propose("", { kind: "decision", name: "Colour", detail: "Red", key: "project/colour" }, source).entry;
  memory.update("", edited.id, { detail: "Green" });
  expect(() => memory.update("", stale.id, { detail: "Pink" }, stale.revision)).toThrow(/changed after/);
  expect(memory.list("").find(entry => entry.id === stale.id)?.detail).toBe("Red");
});

it("requires every query term in shared search, including signed numbers", () => {
  const entry = memory.propose("", { kind: "decision", name: "Grade", detail: "Amber exposure -2", key: "project/grade" }, source).entry;
  memory.resolve("", entry.id, "accept");
  expect(memory.search("", "amber exposure")).toHaveLength(1);
  expect(memory.search("", "amber missing")).toHaveLength(0);
  expect(memory.search("", "exposure -2")).toHaveLength(1);
  expect(memory.search("", "exposure 2")).toHaveLength(0);
});

it("does not allocate section ownership during a read", () => {
  const before = readFileSync(SECTION_CONTEXTS_FILE, "utf8");
  expect(memory.systemPrompt("Read only fixture")).toBe("");
  sectionMemoryKey("Read only fixture");
  expect(readFileSync(SECTION_CONTEXTS_FILE, "utf8")).toBe(before);
});


it("keeps legacy label ownership stable when a write follows a read", () => {
  writeFileSync(SECTION_CONTEXTS_FILE, JSON.stringify({ version: 1, sections: ["Legacy team"], contexts: {} }));
  const old = { id: "legacy", kind: "decision", name: "Colour", detail: "Blue", aliases: [], status: "accepted", source, updatedAt: 1 };
  writeFileSync(join(dir, "team-memory.json"), JSON.stringify({ version: 2, sections: { "Legacy team": [old] } }));
  memory = new TeamMemory(join(dir, "team-memory.json"));
  expect(memory.list("Legacy team")[0].detail).toBe("Blue");
  memory.update("Legacy team", old.id, { detail: "Amber" });
  changeEmptySection("Legacy team", "Renamed legacy");
  expect(new TeamMemory(join(dir, "team-memory.json")).list("Renamed legacy")[0].detail).toBe("Amber");
  ensureSections(["Legacy team"]);
  expect(memory.list("Legacy team")).toEqual([]);
});
