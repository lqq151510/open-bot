import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import type { Message } from "../server/store.ts";

const root = mkdtempSync(join(tmpdir(), "omb-message-pages-bench-"));
const home = join(root, "home");
const data = join(root, "data");
const previous = { HOME: process.env.HOME, OMB_DATA_DIR: process.env.OMB_DATA_DIR };
mkdirSync(home);
mkdirSync(data);
process.env.HOME = home;
process.env.OMB_DATA_DIR = data;

const rows = 50_000;
const limit = 200;
const cursorIndex = 40_000;
const rounds = 9;
const id = (index: number) => `bench-message-${String(index).padStart(5, "0")}`;
const threadId = "bench-thread";
const cursor = id(cursorIndex);
const text = "Synthetic local pagination benchmark. ".repeat(32).slice(0, 1024);
const message = (index: number): Message => ({
  id: id(index), at: 1_700_000_000_000 + index,
  role: index % 2 === 0 ? "user" : "bot", kind: "text", text,
  parentId: index === 0 ? null : id(index - 1),
});
const expected = {
  messages: Array.from({ length: limit }, (_, index) => message(cursorIndex - limit + index)),
  hasMore: true, activeLeafId: id(rows - 1),
};
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const rounded = (value: number) => Number(value.toFixed(3));
let database: typeof import("../server/message-db.ts") | undefined;
let seed: DatabaseSync | undefined;

try {
  const { DATA_DIR } = await import("../server/config.ts");
  assert.equal(DATA_DIR, data);
  database = await import("../server/message-db.ts");
  const { Store } = await import("../server/store.ts");
  const { messagePages, pageMessage } = await import("../server/host/message-pages.ts");
  writeFileSync(join(data, "bots.json"), "[]");
  writeFileSync(join(data, "groups.json"), "[]");
  database.readThread(threadId, join(data, "absent-legacy.json"));
  database.closeMessageDb();
  seed = new DatabaseSync(join(data, "messages.db"));
  const insert = seed.prepare("INSERT INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const seedStart = performance.now();
  seed.exec("BEGIN");
  for (let index = 0; index < rows; index++) {
    const row = message(index);
    insert.run(threadId, row.id, row.at, row.role, row.kind, row.text, JSON.stringify(row));
  }
  seed.prepare("INSERT INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)").run(threadId, id(rows - 1));
  seed.exec("COMMIT");
  seed.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const seedMs = performance.now() - seedStart;
  assert.equal(seed.prepare("SELECT count(*) AS count FROM messages").get()?.count, rows);
  seed.close();
  seed = undefined;

  const freshStore = () => new Store(() => { throw new Error("Benchmark must not select an engine"); });
  function oldPage() {
    const store = freshStore();
    const all = store.messagesFor(threadId);
    const end = all.findIndex((msg) => msg.id === cursor);
    const stop = end === -1 ? all.length : end;
    const start = Math.max(0, stop - limit);
    return {
      messages: all.slice(start, stop).map(pageMessage),
      hasMore: start > 0,
      activeLeafId: store.activeLeaf(threadId),
    };
  }
  const newPage = () => messagePages(freshStore()).messagePage(threadId, limit, cursor);
  for (let warmup = 0; warmup < 2; warmup++) {
    assert.deepEqual(oldPage(), expected);
    assert.deepEqual(newPage(), expected);
  }

  function decodedMessages(run: typeof newPage) {
    const originalParse = JSON.parse;
    let count = 0;
    JSON.parse = (source, reviver) => {
      if (typeof source === "string" && source.startsWith('{"id":"bench-message-')) count++;
      return originalParse(source, reviver);
    };
    try {
      assert.deepEqual(run(), expected);
      return count;
    } finally {
      JSON.parse = originalParse;
    }
  }
  const oldDecoded = decodedMessages(oldPage);
  const newDecoded = decodedMessages(newPage);
  assert.equal(oldDecoded, rows);
  assert.equal(newDecoded, limit);

  const samples = { old: [] as number[], new: [] as number[] };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? ["old", "new"] as const : ["new", "old"] as const;
    for (const variant of order) {
      const start = performance.now();
      const page = variant === "old" ? oldPage() : newPage();
      samples[variant].push(performance.now() - start);
      assert.deepEqual(page, expected);
    }
  }
  const oldMedian = median(samples.old);
  const newMedian = median(samples.new);
  console.log(JSON.stringify({
    benchmark: "message-pages-before-cursor", node: process.version, platform: platform(), arch: arch(),
    rows, textBytesPerMessage: Buffer.byteLength(text), cursor, limit, rounds, seedMs: rounded(seedMs),
    scope: "In-process Store construction + pagination, warm filesystem/shared SQLite connection, fresh Store cache every call. Not HTTP latency.",
    timingInstrumentation: "JSON.parse wrapper runs separately, outside timed samples; assertions outside timed samples.",
    memory: "Not reported: shared-process GC/RSS deltas are not reliable per-call allocation measurements.",
    old: { medianMs: rounded(oldMedian), samplesMs: samples.old.map(rounded), decodedMessages: oldDecoded },
    new: { medianMs: rounded(newMedian), samplesMs: samples.new.map(rounded), decodedMessages: newDecoded },
    medianSpeedup: rounded(oldMedian / newMedian),
    equality: { exactShapeAndValues: true, firstId: expected.messages[0]!.id, lastId: expected.messages.at(-1)!.id, hasMore: expected.hasMore, activeLeafId: expected.activeLeafId },
  }, null, 2));
} finally {
  seed?.close();
  database?.closeMessageDb();
  for (const key of ["HOME", "OMB_DATA_DIR"] as const) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  assert(root.startsWith(join(tmpdir(), "omb-message-pages-bench-")));
  rmSync(root, { recursive: true, force: true });
}
