// What tells a quiet moment for a downloaded update, from Electron and from the servers this app's window talks to.
import { BACKGROUND_HEADERS } from "./cloud-power.mjs";

async function answer(response) {
  const got = await response;
  if (!got.ok) throw new Error(`answered ${got.status}`);
  return got.json();
}

async function activeCall(response) {
  const call = (await answer(response))?.call;
  if (call === null) return false;
  if (typeof call === "object" && !Array.isArray(call)) return true;
  throw new Error("Live call status is unavailable.");
}

/**
 * @param {{
 *   powerMonitor: { getSystemIdleTime(): number, getSystemIdleState(threshold: number): string, on(event: string, listener: () => void): unknown },
 *   window(): null | { isDestroyed(): boolean, isVisible(): boolean, isMinimized(): boolean },
 *   lastInput(): number,
 *   local(route: string, init?: RequestInit): Promise<Response>,
 *   place(): string | null,
 *   cloudFetch(url: string, init?: RequestInit): Promise<Response>,
 *   asleep(origin: string): boolean,
 *   busy(): string | null,
 * }} deps `local`: this computer's server, as its owner. `place`: the origin of My Cloud or a team while the window shows
 * it, where a Live call in this window runs; `asleep`: that Cloud sleeps, so no call runs there, and asking would wake it.
 */
export function quietSignals({ powerMonitor, window, lastInput, local, place, cloudFetch, asleep, busy }) {
  const timeout = () => AbortSignal.timeout(10_000);
  return {
    locked: () => powerMonitor.getSystemIdleState(1) === "locked",
    idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    typedAt: lastInput,
    shown() {
      const win = window();
      return Boolean(win && !win.isDestroyed() && (win.isVisible() || win.isMinimized()));
    },
    busy,
    /** What runs on this computer's server (what the move waits for: a bot's turn, a routine run, a room, a hand-off, a
     * sign-in), or a Live call here or on the Cloud the window shows. */
    async work() {
      const held = await answer(local("/api/move/freeze", { signal: timeout() }));
      if (typeof held?.frozen !== "boolean" || (Object.hasOwn(held, "busy") && typeof held.busy !== "string")) {
        throw new Error("This computer's server did not say what it is doing.");
      }
      if (typeof held.busy === "string") return (typeof held.what === "string" && held.what) || "bot";
      if (await activeCall(local("/api/live/call", { signal: timeout() }))) return "call";
      const origin = place();
      if (origin && !asleep(origin)) {
        if (await activeCall(cloudFetch(`${origin}/api/live/call`, { headers: BACKGROUND_HEADERS, credentials: "include", cache: "no-store", redirect: "error", signal: timeout() }))) return "call";
      }
      return null;
    },
    /** Looks at once when the screen locks: a laptop may sleep soon after. */
    watch(look) {
      powerMonitor.on("lock-screen", () => void look());
    },
  };
}
