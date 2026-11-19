import assert from "node:assert/strict";
import test from "node:test";
import { createMacComputerNameReader } from "./mac-computer-name.mjs";

test("reads the macOS display name with a bounded, read-only command", async () => {
  const read = createMacComputerNameReader({ platform: "darwin", execute: async (file, args, options) => {
    assert.equal(file, "/usr/sbin/scutil");
    assert.deepEqual(args, ["--get", "ComputerName"]);
    assert.deepEqual(options, { encoding: "utf8", timeout: 1_000, maxBuffer: 4_096 });
    return { stdout: "  工作室 Mac 👩‍💻\n" };
  } });
  assert.equal(await read(), "工作室 Mac 👩‍💻");
});

test("bounds the name on character boundaries and removes misleading invisible formatting", async () => {
  const read = createMacComputerNameReader({ platform: "darwin", execute: async () => ({ stdout: `\u202e雪${"🍎".repeat(150)}\u200b\n` }) });
  assert.equal(await read(), `雪${"🍎".repeat(119)}`);
});

test("returns no display name when the platform, system query, or name is unavailable", async () => {
  const read = createMacComputerNameReader({ platform: "darwin", execute: async () => { throw new Error("timed out"); } });
  assert.equal(await read(), null);
  for (const stdout of [" \n", "\u00ad\u200d\u202e"]) {
    const readEmpty = createMacComputerNameReader({ platform: "darwin", execute: async () => ({ stdout }) });
    assert.equal(await readEmpty(), null);
  }
  for (const platform of ["linux", "win32"]) {
    let called = false;
    const readUnsupported = createMacComputerNameReader({ platform, execute: async () => { called = true; } });
    assert.equal(await readUnsupported(), null);
    assert.equal(called, false);
  }
});

test("concurrent callers share a query and the next query can see a rename", async () => {
  let calls = 0;
  const read = createMacComputerNameReader({ platform: "darwin", execute: async () => ({ stdout: `Studio Mac ${++calls}\n` }) });
  assert.deepEqual(await Promise.all([read(), read()]), ["Studio Mac 1", "Studio Mac 1"]);
  assert.equal(await read(), "Studio Mac 2");
});
