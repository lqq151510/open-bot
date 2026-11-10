import { useTurnLive, type TurnLive } from "@/state/turn-status";
import { normalizeState, type MausState } from "./mascot";
import { lastNonReceipt } from "./receipts";

export type SidebarPresence = "idle" | "thinking" | "working" | "waiting" | "blocked";

type Activity = "working" | "waiting-on-you" | "idle" | "no-signal" | "dead" | "parked.computer";

export interface SidebarPresenceBot {
  threadId: string;
  busy?: boolean;
  activity?: Activity;
  waitingForTeammates?: boolean;
  mascotExpression?: string | null;
  tasks?: Array<{ threadId: string; busy?: boolean; activity?: Activity; waitingForTeammates?: boolean }>;
  messages?: Array<{ kind: string; tool?: { ok?: boolean } }>;
}

const STUCK = new Set<Activity>(["no-signal", "dead", "parked.computer"]);

const FACE = {
  thinking: "thinking",
  working: "working",
  waiting: "listening",
  blocked: "alerting",
} as const satisfies Record<Exclude<SidebarPresence, "idle">, MausState>;

export function presenceThreadId(bot: SidebarPresenceBot): string {
  const task = bot.tasks?.find((item) =>
    item.busy === true || item.activity === "working" || item.activity === "waiting-on-you" || (item.activity !== undefined && STUCK.has(item.activity)));
  return task?.threadId ?? bot.threadId;
}

export function sidebarPresence(bot: SidebarPresenceBot, live: TurnLive | null): SidebarPresence {
  const activities = [bot.activity, ...(bot.tasks?.map((task) => task.activity) ?? [])];
  if (activities.some((activity) => activity !== undefined && STUCK.has(activity))) return "blocked";
  const waiting = bot.activity === "waiting-on-you"
    || bot.waitingForTeammates === true
    || bot.tasks?.some((task) => task.activity === "waiting-on-you" || task.waitingForTeammates === true) === true;
  if (waiting) return "waiting";
  const busy = bot.busy === true || bot.tasks?.some((task) => task.busy === true || task.activity === "working") === true;
  const liveActivity = live && !live.ended ? live.status?.activity : undefined;
  if (busy && (liveActivity === "thinking" || liveActivity === undefined)) return "thinking";
  if (busy || liveActivity === "reply") return "working";
  const last = lastNonReceipt(bot.messages);
  if (last?.kind === "activity" && last.tool?.ok === false) return "blocked";
  return "idle";
}

export function sidebarAvatarState(bot: SidebarPresenceBot, live: TurnLive | null): MausState {
  const presence = sidebarPresence(bot, live);
  if (presence === "idle") return normalizeState(bot.mascotExpression) ?? "idle";
  return FACE[presence];
}

export function useSidebarAvatar(bot: SidebarPresenceBot): { presence: SidebarPresence; state: MausState } {
  const live = useTurnLive(presenceThreadId(bot));
  const presence = sidebarPresence(bot, live);
  return { presence, state: sidebarAvatarState(bot, live) };
}
