import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const unavailable = () => ({ status: "unavailable" });
const WEATHER_SHORTCUT = "OpenBot Weather";

export async function runWeatherShortcut(launch = run) {
  try {
    const { stdout } = await launch("/usr/bin/shortcuts", ["run", WEATHER_SHORTCUT, "--output-type", "public.plain-text"], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 16_384,
    });
    const text = stdout.trim();
    return text && text.length <= 2_000 ? { status: "ready", text } : unavailable();
  } catch {
    return unavailable();
  }
}

export async function runCalendarHelper(bundle, args, { launch = run, temp = tmpdir() } = {}) {
  const dir = await mkdtemp(path.join(temp, "openbot-calendar-"));
  try {
    const result = path.join(dir, "result.json");
    await launch("/usr/bin/open", ["-n", "-g", "-W", "-a", bundle, "--args", result, ...args], { timeout: 90_000 });
    return JSON.parse(await readFile(result, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function validSelection(ids, days) {
  return (days === 1 || days === 7) && Array.isArray(ids) && ids.length > 0 && ids.length <= 100 &&
    [...ids].every(id => typeof id === "string" && id.length > 0 && id.length <= 512 && !id.includes("\0"));
}

export function installLocalCalendar({ ipcMain, guard, supported, available, bundle, ensureBuilt, openShortcuts, weather = runWeatherShortcut, invoke = runCalendarHelper }) {
  let pending = null;
  let weatherPending = false;
  const call = (args) => {
    if (!available()) return unavailable();
    if (!supported()) return { status: "unsupported" };
    const key = JSON.stringify(args);
    if (pending) return pending.key === key ? pending.result : { status: "busy" };
    const result = Promise.resolve().then(ensureBuilt).then(() => invoke(bundle, args))
      .catch(unavailable).finally(() => { pending = null; });
    pending = { key, result };
    return result;
  };
  const handle = (name, handler) => {
    const channel = `local-calendar:${name}`;
    ipcMain.handle(channel, guard(channel, handler));
  };
  handle("list", () => call(["list"]));
  handle("status", () => call(["status"]));
  handle("request", () => call(["request"]));
  handle("preview", (_event, ids, days) => validSelection(ids, days)
    ? call(["events", String(days), ...new Set(ids)])
    : { status: "invalidSelection" });
  handle("weather", async () => {
    if (!available()) return unavailable();
    if (weatherPending) return { status: "busy" };
    weatherPending = true;
    try {
      return await weather();
    } catch {
      return unavailable();
    } finally {
      weatherPending = false;
    }
  });
  handle("open-shortcuts", () => available() && openShortcuts());
}
