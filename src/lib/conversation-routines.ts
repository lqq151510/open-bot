import type { RoutineGoalStatus, RoutineRunStatus } from "../../shared/routines";

const LIVE = new Set<RoutineRunStatus>(["queued", "running", "waiting"]);

export interface ConversationRoutineRef {
  id: string;
  name: string;
  botId: string;
  sourceThreadId?: string;
  resultsThreadId?: string;
  createdAt: number;
}

export interface ConversationRunRef {
  id: string;
  routineId: string;
  routineName: string;
  botId: string;
  status: RoutineRunStatus;
  sourceThreadId?: string;
  resultsThreadId?: string;
  threadId?: string;
  executionThreadId?: string;
  createdAt: number;
  startedAt?: number;
  scheduledFor: number;
  output?: string;
  error?: string;
  goalStatus?: RoutineGoalStatus;
}

export type ConversationRoutineItem =
  | { kind: "created"; routineId: string; botId: string; name: string; at: number }
  | { kind: "run"; routineId: string; botId: string; name: string; at: number; run: ConversationRunRef };

export function postedRoutineRunIds(messages: readonly { kind: string; routineRun?: { runId?: string } }[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === "routine.run" && message.routineRun?.runId) ids.add(message.routineRun.runId);
  }
  return ids;
}

function tied(routine: ConversationRoutineRef, threadId: string, mainThreadId: string, anyBot: boolean): boolean {
  if (routine.sourceThreadId === threadId || routine.resultsThreadId === threadId) return true;
  if (anyBot) return false;
  return routine.sourceThreadId === undefined && routine.resultsThreadId === undefined && threadId === mainThreadId;
}

function newest(runs: readonly ConversationRunRef[]): ConversationRunRef | undefined {
  return runs.reduce<ConversationRunRef | undefined>((best, run) => {
    if (!best) return run;
    const at = run.startedAt ?? run.createdAt;
    const bestAt = best.startedAt ?? best.createdAt;
    return at >= bestAt ? run : best;
  }, undefined);
}

export function conversationRoutineItems(input: {
  threadId: string;
  botId: string | null;
  mainThreadId: string;
  routines: readonly ConversationRoutineRef[];
  runs: readonly ConversationRunRef[];
  postedRunIds: ReadonlySet<string>;
}): ConversationRoutineItem[] {
  const anyBot = input.botId === null;
  const mine = (botId: string) => anyBot || botId === input.botId;
  const items: ConversationRoutineItem[] = [];
  const seen = new Set<string>();
  const here = input.routines.filter((routine) => mine(routine.botId) && tied(routine, input.threadId, input.mainThreadId, anyBot));

  for (const routine of here) {
    const own = input.runs.filter((run) => run.routineId === routine.id && mine(run.botId) && !input.postedRunIds.has(run.id));
    const visible = own.filter((run) => LIVE.has(run.status) || run.sourceThreadId === input.threadId || run.resultsThreadId === input.threadId);
    const latest = newest(visible);
    const posted = input.runs.some((run) => run.routineId === routine.id && input.postedRunIds.has(run.id));
    if (routine.sourceThreadId === input.threadId && !posted) {
      items.push({ kind: "created", routineId: routine.id, botId: routine.botId, name: routine.name, at: routine.createdAt });
    }
    if (latest) {
      seen.add(latest.id);
      items.push({
        kind: "run", routineId: routine.id, botId: latest.botId, name: routine.name,
        at: latest.startedAt ?? latest.createdAt, run: latest,
      });
    }
  }

  if (!anyBot && input.threadId === input.mainThreadId) {
    for (const run of input.runs) {
      if (!mine(run.botId) || seen.has(run.id) || input.postedRunIds.has(run.id) || !LIVE.has(run.status)) continue;
      items.push({
        kind: "run", routineId: run.routineId, botId: run.botId, name: run.routineName,
        at: run.startedAt ?? run.createdAt, run,
      });
    }
  }
  return items.sort((a, b) => a.at - b.at || a.routineId.localeCompare(b.routineId));
}
