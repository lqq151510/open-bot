import { describe, expect, it } from "vitest";
import type { TurnLive } from "@/state/turn-status";
import { sidebarAvatarState, sidebarPresence } from "./sidebar-presence";

const idle = { threadId: "main", name: "Atlas" };

const thinking: TurnLive = { ended: false, status: { activity: "thinking" } };
const command: TurnLive = { ended: false, status: { activity: "command" } };
const quiet: TurnLive = { ended: false, status: null };

describe("sidebarPresence", () => {
  it("rests on idle, or on the face the person pinned", () => {
    expect(sidebarPresence(idle, null)).toBe("idle");
    expect(sidebarAvatarState(idle, null)).toBe("idle");
    expect(sidebarAvatarState({ ...idle, mascotExpression: "happy" }, null)).toBe("happy");
  });

  it("shows thinking before any tool, and working once a tool is running", () => {
    const busy = { ...idle, busy: true, activity: "working" as const };
    expect(sidebarPresence(busy, quiet)).toBe("thinking");
    expect(sidebarPresence(busy, thinking)).toBe("thinking");
    expect(sidebarAvatarState(busy, command)).toBe("working");
  });

  it("shows waiting while a person or a teammate is holding the turn", () => {
    expect(sidebarPresence({ ...idle, activity: "waiting-on-you" }, command)).toBe("waiting");
    expect(sidebarAvatarState({ ...idle, waitingForTeammates: true }, null)).toBe("listening");
  });

  it("shows blocked when the computer is stuck or the last step failed", () => {
    expect(sidebarPresence({ ...idle, activity: "parked.computer" }, null)).toBe("blocked");
    expect(sidebarPresence({ ...idle, activity: "dead" }, null)).toBe("blocked");
    expect(sidebarAvatarState({
      ...idle,
      messages: [{ kind: "activity", tool: { ok: false } }, { kind: "digest" }],
    }, null)).toBe("alerting");
    expect(sidebarPresence({
      ...idle,
      busy: true,
      messages: [{ kind: "activity", tool: { ok: false } }],
    }, command)).toBe("working");
  });
});
