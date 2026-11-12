import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTemporaryMeetingProfile, launchChrome, stopMeetingChrome, type MeetbotConfig } from "./meetbot.ts";

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-"));
  dirs.push(dir);
  const owned = createTemporaryMeetingProfile(dir);
  const profile = owned.path;
  writeFileSync(join(profile, "History"), "private fixture");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  children.push(child);
  await once(child, "spawn");
  return { child, profile, owned };
}

it.skipIf(process.platform === "win32")("removes a meeting-owned profile only after its browser group exits", async () => {
  const { child, profile, owned } = await fixture();
  expect(await stopMeetingChrome(child, owned)).toBe(true);
  expect(existsSync(profile)).toBe(false);
});

it.skipIf(process.platform === "win32")("keeps a shared profile after stopping the browser group", async () => {
  const { child, profile } = await fixture();
  expect(await stopMeetingChrome(child)).toBe(true);
  expect(existsSync(join(profile, "History"))).toBe(true);
});

it.skipIf(process.platform === "win32")("does not delete a replacement symlink or its target", async () => {
  const { child, profile, owned } = await fixture();
  const victim = mkdtempSync(join(tmpdir(), "meeting-profile-victim-"));
  dirs.push(victim);
  writeFileSync(join(victim, "History"), "shared fixture");
  rmSync(profile, { recursive: true });
  symlinkSync(victim, profile);
  expect(await stopMeetingChrome(child, owned)).toBe(false);
  expect(existsSync(join(victim, "History"))).toBe(true);
  expect(existsSync(profile)).toBe(true);
});

it.skipIf(process.platform === "win32")("keeps a profile when process group signalling is denied", async () => {
  const { child, profile, owned } = await fixture();
  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw denied; });
  try {
    expect(await stopMeetingChrome(child, owned)).toBe(false);
    expect(existsSync(join(profile, "History"))).toBe(true);
  } finally {
    kill.mockRestore();
  }
});

it.skipIf(process.platform === "win32")("forces down a browser group that ignores SIGTERM before removing its profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-stubborn-"));
  dirs.push(dir);
  const owned = createTemporaryMeetingProfile(dir);
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  children.push(child);
  await once(child.stdout!, "data");
  expect(await stopMeetingChrome(child, owned)).toBe(true);
  expect(existsSync(owned.path)).toBe(false);
}, 10_000);

it("does not reuse a pre-existing default profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-"));
  dirs.push(dir);
  mkdirSync(join(dir, "profile"));
  writeFileSync(join(dir, "profile", "History"), "existing fixture");
  expect(() => createTemporaryMeetingProfile(dir)).toThrow();
  expect(existsSync(join(dir, "profile", "History"))).toBe(true);
});

it.skipIf(process.platform === "win32")("does not create a temporary profile through a symlinked meeting directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-parent-"));
  dirs.push(dir);
  const target = join(dir, "target");
  const alias = join(dir, "alias");
  mkdirSync(target);
  symlinkSync(target, alias);
  expect(() => createTemporaryMeetingProfile(alias)).toThrow();
  expect(existsSync(join(target, "profile"))).toBe(false);
});

it.skipIf(process.platform === "win32")("cleans an owned profile when the browser exits during startup but keeps a shared profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-start-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ffmpeg"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const ownedDir = join(dir, "owned");
  const sharedDir = join(dir, "shared");
  const sharedProfile = join(dir, "shared-profile");
  mkdirSync(ownedDir);
  mkdirSync(sharedDir);
  mkdirSync(sharedProfile);
  writeFileSync(join(sharedProfile, "History"), "shared fixture");
  const config: MeetbotConfig = { url: "https://meet.google.com/abc-defg-hij", platform: "meet", name: "Fixture", consent: "Notice", stt: { kind: "whisper" }, maxMs: 1000, lobbyMs: 1000, aloneMs: 1000, chrome: process.execPath };
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    await expect(launchChrome(ownedDir, config, "fixture")).rejects.toThrow();
    expect(existsSync(join(ownedDir, "profile"))).toBe(false);
    await expect(launchChrome(sharedDir, { ...config, profileDir: sharedProfile }, "fixture")).rejects.toThrow();
    expect(existsSync(join(sharedProfile, "History"))).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

it("does not remove a profile when no browser process is known", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-profile-"));
  dirs.push(dir);
  const owned = createTemporaryMeetingProfile(dir);
  expect(await stopMeetingChrome({} as ChildProcess, owned)).toBe(false);
  expect(existsSync(owned.path)).toBe(true);
});
