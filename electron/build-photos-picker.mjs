import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const resources = fileURLToPath(new URL("./resources/", import.meta.url));
const sources = ["photos-picker.swift", "photos-export.swift"].map(file => path.join(resources, file));
const plist = path.join(resources, "photos-picker-Info.plist");
export const photosAppName = "OpenBot Photos.app";
export const photosBuildBundle = fileURLToPath(new URL(`../dist-native/mac-helpers/${photosAppName}`, import.meta.url));
export const photosPickerExecutable = bundle => path.join(bundle, "Contents", "MacOS", "photos-picker");

export async function buildPhotosPicker(bundle = photosBuildBundle) {
  const binary = photosPickerExecutable(bundle);
  await mkdir(path.dirname(binary), { recursive: true });
  const slices = ["arm64", "x86_64"].map(arch => ({ arch, file: `${binary}-${arch}` }));
  try {
    await copyFile(plist, path.join(bundle, "Contents", "Info.plist"));
    const compiled = await Promise.allSettled(slices.map(({ arch, file }) => run("/usr/bin/swiftc", [
      "-swift-version", "6", "-O", "-parse-as-library", "-target", `${arch}-apple-macosx13.0`, ...sources, "-o", file,
    ], { timeout: 90_000 })));
    const failure = compiled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    await run("/usr/bin/lipo", ["-create", ...slices.map(slice => slice.file), "-output", binary], { timeout: 15_000 });
  } finally {
    await Promise.all(slices.map(({ file }) => rm(file, { force: true })));
  }
  await run("/usr/bin/codesign", ["--force", "--sign", "-", bundle], { timeout: 30_000 });
}

export async function ensurePhotosPicker() {
  const built = await stat(photosPickerExecutable(photosBuildBundle)).catch(() => null);
  const modified = await Promise.all([...sources, plist].map(file => stat(file).then(entry => entry.mtimeMs)));
  const signed = built && await run("/usr/bin/codesign", ["--verify", photosBuildBundle], { timeout: 5_000 }).then(() => true, () => false);
  if (!signed || !built || built.mtimeMs < Math.max(...modified)) await buildPhotosPicker();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildPhotosPicker();
