import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { photosPickerExecutable } from "./build-photos-picker.mjs";

const run = promisify(execFile);
const IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 10;
const MAX_BYTES = 4 * IMAGE_BYTES;
const unavailable = () => ({ status: "unavailable" });

export async function pickLocalPhotos(bundle, { limit, bytes, title, loading, signal }, launch = run) {
  const directory = await mkdtemp(path.join(tmpdir(), "openbot-photos-"));
  try {
    await launch(photosPickerExecutable(bundle), [directory, String(limit), String(bytes), title, loading], {
      signal, timeout: 5 * 60_000, maxBuffer: 32_768,
    });
    const result = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8"));
    if (result?.status === "cancelled") return { status: "cancelled" };
    const { count, skipped } = result ?? {};
    if (result?.status !== "selected" || !Number.isInteger(count) || count < 0 || count > limit ||
        !Number.isInteger(skipped) || skipped < 0 || count + skipped < 1 || count + skipped > limit) return unavailable();

    const photos = [];
    let remaining = bytes;
    for (let index = 1; index <= count; index++) {
      const file = path.join(directory, `photo-${index}.jpg`);
      const info = await lstat(file);
      if (!info.isFile() || info.size < 4 || info.size > Math.min(remaining, IMAGE_BYTES)) return unavailable();
      const photo = await readFile(file);
      if (photo.length !== info.size || photo[0] !== 0xff || photo[1] !== 0xd8 || photo.at(-2) !== 0xff || photo.at(-1) !== 0xd9) return unavailable();
      photos.push(Uint8Array.from(photo));
      remaining -= photo.length;
    }
    return { status: "selected", photos, skipped };
  } catch {
    return signal?.aborted ? { status: "cancelled" } : unavailable();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function installLocalPhotos({ ipcMain, guard, available, bundle, ensureBuilt, t, pick = pickLocalPhotos }) {
  let picking = false;
  const channel = "local-photos:pick";
  ipcMain.handle(channel, guard(channel, async (event, limit, bytes) => {
    const contents = event.sender;
    if (!available() || contents.isDestroyed() || event.senderFrame !== contents.mainFrame) return unavailable();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PHOTOS || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) return unavailable();
    if (picking) return { status: "busy" };
    picking = true;
    const stop = new AbortController();
    const cancel = () => stop.abort();
    const navigate = (_event, _url, sameDocument, mainFrame) => { if (mainFrame && !sameDocument) cancel(); };
    contents.on("did-start-navigation", navigate);
    contents.once("destroyed", cancel);
    contents.once("render-process-gone", cancel);
    try {
      await ensureBuilt();
      if (stop.signal.aborted) return { status: "cancelled" };
      const result = await pick(bundle, { limit, bytes, title: t("native.photos.title"), loading: t("native.photos.loading"), signal: stop.signal });
      return stop.signal.aborted ? { status: "cancelled" } : result;
    } catch {
      return unavailable();
    } finally {
      contents.removeListener("did-start-navigation", navigate);
      contents.removeListener("destroyed", cancel);
      contents.removeListener("render-process-gone", cancel);
      picking = false;
    }
  }));
}
