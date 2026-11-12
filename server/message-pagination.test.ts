import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { createThreadRoutes, type ThreadRouteDeps } from "./routes/threads.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import * as mdb from "./message-db.ts";
import { Store, type Message } from "./store.ts";
import { messagePages } from "./host/message-pages.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
const legacy = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);
const row = (i: number): Message => ({ id: `m${i}`, role: "user", kind: "text", text: `pagination-fixture-${i}`, at: 1000 - i, parentId: i ? `m${i - 1}` : null });

beforeEach(() => {
  mdb.closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

describe("bounded older-message pages", () => {
  it("pages in insertion order, excludes the cursor, scopes IDs to a thread and handles boundaries", () => {
    for (let i = 0; i < 8; i++) mdb.insertMessage("t", row(i));
    mdb.insertMessage("other", row(7));
    mdb.setActiveLeaf("t", "m7");
    expect(mdb.readThreadBefore("t", legacy("t"), "m6", 3)).toEqual({ messages: [row(3), row(4), row(5)], hasMore: true, activeLeafId: "m7" });
    expect(mdb.readThreadBefore("t", legacy("t"), "m3", 3)).toMatchObject({ messages: [row(0), row(1), row(2)], hasMore: false });
    expect(mdb.readThreadBefore("t", legacy("t"), "m0", 3)).toMatchObject({ messages: [], hasMore: false });
    expect(mdb.readThreadBefore("t", legacy("t"), "m6", 0)).toMatchObject({ messages: [], hasMore: true });
    expect(mdb.readThreadBefore("t", legacy("t"), "missing", 3)).toBeNull();
    expect(mdb.readThreadBefore("absent", legacy("absent"), "m7", 3)).toBeNull();
  });

  it("does not decode or cache a whole modern transcript when paging through the host helper", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    for (let i = 0; i < 600; i++) mdb.insertMessage(bot.threadId, row(i));
    mdb.setActiveLeaf(bot.threadId, "m599");
    const fresh = new Store(selection);
    const read = vi.spyOn(mdb, "readThread");
    const parse = vi.spyOn(JSON, "parse");
    try {
      const page = messagePages(fresh).messagePage(bot.threadId, 20, "m400");
      expect(page).toMatchObject({ messages: Array.from({ length: 20 }, (_, i) => row(i + 380)), hasMore: true, activeLeafId: "m599" });
      expect(read).not.toHaveBeenCalled();
      expect(parse.mock.calls.filter(([text]) => text.includes("pagination-fixture-"))).toHaveLength(20);
      expect(messagePages(fresh).messagePage(bot.threadId, 20, "missing")).toBeNull();
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      parse.mockRestore();
    }
    expect(fresh.messagesFor(bot.threadId)).toHaveLength(600);
  });

  it("serves a cold HTTP page and rejects missing cursors without full transcript or active-leaf loading", async () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    for (let i = 0; i < 600; i++) mdb.insertMessage(bot.threadId, row(i));
    mdb.setActiveLeaf(bot.threadId, "m599");
    const fresh = new Store(selection);
    const fullRead = vi.spyOn(fresh, "messagesFor");
    const leafRead = vi.spyOn(fresh, "activeLeaf");
    const read = vi.spyOn(mdb, "readThread");
    const deps = { store: fresh, ...messagePages(fresh), pageSize: (value: string | null) => value === null ? undefined : Number(value),
      viewerFor: () => ({}), visibleTo: () => ({ bot: () => true, group: () => true }), workspaceAccess: () => null,
      desktopMutationToken: () => undefined, companionMutationToken: () => undefined, cliOwnerToken: () => undefined } as unknown as ThreadRouteDeps;
    const routes = [createThreadRoutes(deps)];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] } as RequestAuth, json, readBody });
        if (!handled) json(res, 404, { error: "not found" });
      } catch { json(res, 500, { error: "route failed" }); }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/threads/${bot.threadId}/messages`;
      const response = await fetch(`${base}?before=m400&limit=20`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ messages: Array.from({ length: 20 }, (_, i) => row(380 + i)), hasMore: true, activeLeafId: "m599" });
      expect((await fetch(`${base}?before=missing&limit=20`)).status).toBe(404);
      expect(fullRead).not.toHaveBeenCalled();
      expect(leafRead).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fullRead.mockRestore(); leafRead.mockRestore(); read.mockRestore();
    }
  });

  it("preserves cached messages and normalizes old parent chains on a full-load fallback", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const messages = Array.from({ length: 5 }, (_, i) => store.appendMessage(bot.threadId, { role: "user", kind: "text", text: `cached ${i}` }));
    expect(store.messagesBefore(bot.threadId, messages[4].id, 2)).toEqual({ messages: messages.slice(2, 4), hasMore: true, activeLeafId: messages[4].id });
    const oldThread = "legacy-chain";
    for (let i = 0; i < 5; i++) { const { parentId: _parent, ...old } = row(i); mdb.insertMessage(oldThread, old as Message); }
    const fresh = new Store(selection);
    expect(fresh.messagesBefore(oldThread, "m4", 2)).toEqual({ messages: [row(2), row(3)], hasMore: true, activeLeafId: "m4" });
    expect(fresh.messagesFor(oldThread)).toEqual(Array.from({ length: 5 }, (_, i) => row(i)));
  });

  it("imports a legacy file before validating its cursor and never caches a partial page as a full thread", () => {
    const threadId = "legacy-file";
    writeFileSync(legacy(threadId), JSON.stringify(Array.from({ length: 5 }, (_, i) => row(i))));
    const fresh = new Store(selection);
    expect(fresh.messagesBefore(threadId, "m4", 2)).toEqual({ messages: [row(2), row(3)], hasMore: true, activeLeafId: "m4" });
    expect(fresh.messagesFor(threadId)).toHaveLength(5);
    expect(fresh.messagesBefore(threadId, "missing", 2)).toBeNull();
  });
});
