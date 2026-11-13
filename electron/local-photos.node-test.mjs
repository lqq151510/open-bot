import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { installLocalPhotos, pickLocalPhotos } from "./local-photos.mjs";
import origin from "./local-origin.cjs";

const jpeg = Uint8Array.of(0xff, 0xd8, 0x00, 0xff, 0xd9);
const labels = { title: "Choose Photos", loading: "Preparing photos…" };
const bundle = "/path/to/OpenBot Photos.app";

test("hands back only the helper's numbered JPEGs within the draft budget and removes the temporary copies", async () => {
  let directory;
  const result = await pickLocalPhotos(bundle, { ...labels, limit: 2, bytes: 30 }, async (binary, args) => {
    assert.equal(binary, path.join(bundle, "Contents/MacOS/photos-picker"));
    directory = args[0];
    assert.deepEqual(args.slice(1), ["2", "30", labels.title, labels.loading]);
    await writeFile(path.join(directory, "photo-1.jpg"), jpeg);
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ status: "selected", count: 1, skipped: 1 }));
  });
  assert.deepEqual(result, { status: "selected", photos: [jpeg], skipped: 1 });
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("refuses oversized results and symlinks without reading the referenced file", async () => {
  for (const makeFile of [file => writeFile(file, jpeg), file => symlink("/dev/zero", file)]) {
    const result = await pickLocalPhotos(bundle, { ...labels, limit: 1, bytes: 4 }, async (_binary, [directory]) => {
      await makeFile(path.join(directory, "photo-1.jpg"));
      await writeFile(path.join(directory, "result.json"), '{"status":"selected","count":1,"skipped":0}');
    });
    assert.deepEqual(result, { status: "unavailable" });
  }
});

test("only the local main frame opens a picker and navigation cancels its pending reply", async () => {
  origin.setLocalOrigin("http://localhost:10042");
  const sender = Object.assign(new EventEmitter(), { mainFrame: { url: "http://localhost:10042/" }, isDestroyed: () => false });
  const local = { sender, senderFrame: sender.mainFrame };
  let handler, selection;
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  installLocalPhotos({
    ipcMain: { handle: (_channel, handle) => { handler = handle; } },
    guard: origin.localOnly,
    available: () => true,
    bundle,
    ensureBuilt: async () => {},
    t: key => key,
    pick: async (_bundle, { signal }) => {
      selection = signal;
      ready();
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return { status: "selected", photos: [jpeg], skipped: 0 };
    },
  });
  assert.throws(() => handler({ sender, senderFrame: { url: "https://remote.example.test" } }, 1, 30), /local server/);
  assert.deepEqual(await handler({ sender, senderFrame: { ...sender.mainFrame } }, 1, 30), { status: "unavailable" });
  assert.deepEqual(await handler(local, 11, 30), { status: "unavailable" });
  const pending = handler(local, 2, 30);
  await started;
  assert.deepEqual(await handler(local, 1, 30), { status: "busy" });
  sender.emit("did-start-navigation", {}, "http://localhost:10042/#chat", true, true);
  assert.equal(selection.aborted, false);
  sender.emit("did-start-navigation", {}, "https://remote.example.test", false, true);
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.equal(sender.listenerCount("did-start-navigation"), 0);
});
