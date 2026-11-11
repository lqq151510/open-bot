import { useMemo } from "react";

import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import {
  conversationRoutineItems,
  postedRoutineRunIds,
  type ConversationRunRef,
} from "@/lib/conversation-routines";
import { openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import type { RoutineRunStatus } from "../../shared/routines";

function statusKey(status: RoutineRunStatus): LocaleKey {
  switch (status) {
    case "queued": return "routines.status.queued";
    case "running": return "routines.status.running";
    case "waiting": return "routines.status.waiting";
    case "completed": return "routines.status.completed";
    case "failed": return "routines.status.failed";
    case "cancelled": return "routines.status.cancelled";
    case "missed": return "routines.status.missed";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function openRun(run: ConversationRunRef): string | undefined {
  return run.executionThreadId ?? run.threadId;
}

export function ConversationRoutines({
  botId,
  threadId,
  mainThreadId,
  messages,
}: {
  botId: string | null;
  threadId: string;
  mainThreadId: string;
  messages: readonly Message[];
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const postedRunIds = useMemo(() => postedRoutineRunIds(messages), [messages]);
  const items = useMemo(() => conversationRoutineItems({
    threadId, botId, mainThreadId, routines: state.routines, runs: state.routineRuns, postedRunIds,
  }), [botId, mainThreadId, postedRunIds, state.routineRuns, state.routines, threadId]);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="conversation-routines">
      {items.map((item) => {
        const runThread = item.kind === "run" ? openRun(item.run) : undefined;
        return (
          <section
            key={item.kind === "run" ? item.run.id : `created:${item.routineId}`}
            data-conversation-routine={item.kind}
            data-routine-id={item.routineId}
            className="w-full max-w-[680px] rounded-xl border border-hairline/45 bg-card px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-[14px] font-semibold text-ink">{item.name}</h3>
              <span className="shrink-0 text-[12px] font-semibold text-ink-secondary">
                {item.kind === "created" ? t("routines.conversation.created") : t(statusKey(item.run.status))}
              </span>
            </div>
            {runThread && (
              <button
                type="button"
                className="mt-1 text-[12px] font-semibold text-accent hover:underline"
                onClick={() => openThread(dispatch, { botId: item.botId, threadId: runThread }, state, showThreads)}
              >
                {t("routines.run.open")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
