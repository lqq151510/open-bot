import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const resources = fileURLToPath(new URL("./resources/", import.meta.url));
const source = path.join(resources, "calendar-helper.swift");
const plist = path.join(resources, "calendar-helper-Info.plist");
const chinesePlist = path.join(resources, "macos", "calendar", "zh-Hans.lproj", "InfoPlist.strings");
export const calendarAppName = "OpenBot Calendar.app";
export const calendarBuildBundle = fileURLToPath(new URL(`../dist-native/mac-helpers/${calendarAppName}`, import.meta.url));

export async function buildCalendarHelper(bundle = calendarBuildBundle) {
  const binary = path.join(bundle, "Contents", "MacOS", "calendar-helper");
  const localization = path.join(bundle, "Contents", "Resources", "zh-Hans.lproj");
  await mkdir(path.dirname(binary), { recursive: true });
  const slices = ["arm64", "x86_64"].map(arch => ({ arch, file: `${binary}-${arch}` }));
  try {
    await copyFile(plist, path.join(bundle, "Contents", "Info.plist"));
    await mkdir(localization, { recursive: true });
    await copyFile(chinesePlist, path.join(localization, "InfoPlist.strings"));
    const compiled = await Promise.allSettled(slices.map(({ arch, file }) => run("/usr/bin/swiftc", [
      "-O", "-parse-as-library", "-target", `${arch}-apple-macosx14.0`, source, "-o", file,
    ], { timeout: 90_000 })));
    const failure = compiled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    await run("/usr/bin/lipo", ["-create", ...slices.map(slice => slice.file), "-output", binary], { timeout: 15_000 });
  } finally {
    await Promise.all(slices.map(({ file }) => rm(file, { force: true })));
  }
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", bundle], { timeout: 30_000 });
}

export async function ensureCalendarHelper() {
  const binary = path.join(calendarBuildBundle, "Contents", "MacOS", "calendar-helper");
  const localization = path.join(calendarBuildBundle, "Contents", "Resources", "zh-Hans.lproj", "InfoPlist.strings");
  const [built, localized, src, info, chinese] = await Promise.all([stat(binary).catch(() => null), stat(localization).catch(() => null), stat(source), stat(plist), stat(chinesePlist)]);
  if (!built || !localized || built.mtimeMs < Math.max(src.mtimeMs, info.mtimeMs) || localized.mtimeMs < chinese.mtimeMs) await buildCalendarHelper();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildCalendarHelper();
