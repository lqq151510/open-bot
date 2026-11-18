import { useEffect, useState } from "react";
import { Eye, Hand, Loader2, Monitor, Pause, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  parseComputerHelp,
  transitionComputerControlLease,
  type ComputerControlAction,
} from "@/lib/computer-control";
import { writeComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import { effectivePlace, type EffectivePlace } from "@/lib/place";
import { api, useStore, type AppState, type Bot } from "@/state/store";

export interface LocalAssistantTarget {
  bot: Bot;
  place: EffectivePlace;
  mode: "local" | "control";
  busy: boolean;
  held: boolean;
  heldByOther: boolean;
  helpReason: string | null;
}

export function selectLocalAssistantTargets(
  state: Pick<AppState, "bots" | "selectedId" | "computerControl">,
): LocalAssistantTarget[] {
  const candidates: Array<LocalAssistantTarget & { score: number }> = [];

  for (const bot of state.bots) {
    if (bot.hidden) continue;
    const busy = Boolean(bot.busy || bot.tasks?.some((task) => task.busy));
    const activeTask =
      bot.tasks?.find((task) => task.busy || task.activity === "working") ??
      bot.tasks?.find((task) => task.threadId === bot.threadId);
    const place = effectivePlace(bot, activeTask);
    const control = state.computerControl[bot.id];
    const held = control?.held === true;
    const heldByOther = control?.heldByOther === true;
    const helpReason = control?.helpReason ?? null;
    const hasControl = held || Boolean(helpReason);
    const activeHere = busy && (place === "local" || place === "vm");

    if (!activeHere && !hasControl) continue;

    const mode: LocalAssistantTarget["mode"] =
      hasControl || place === "vm" ? "control" : "local";
    const score =
      (hasControl ? 4 : 0) +
      (bot.id === state.selectedId ? 2 : 0) +
      (place === "local" ? 1 : 0);

    candidates.push({
      bot,
      place,
      mode,
      busy,
      held,
      heldByOther,
      helpReason,
      score,
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates.map(({ score: _score, ...target }) => target);
}

export function selectLocalAssistantTarget(
  state: Pick<AppState, "bots" | "selectedId" | "computerControl">,
): LocalAssistantTarget | null {
  return selectLocalAssistantTargets(state)[0] ?? null;
}

function statusCopy(target: LocalAssistantTarget): string {
  if (target.mode === "local") {
    return t("localBar.workingLocal", { name: target.bot.name });
  }
  if (target.held) {
    return t("localBar.held", { name: target.bot.name });
  }
  if (target.helpReason) {
    return t("localBar.helpNeeded", { name: target.bot.name, reason: target.helpReason });
  }
  return t("localBar.workingVm", { name: target.bot.name });
}

export function LocalAssistantBar() {
  const { state, dispatch } = useStore();
  const target = selectLocalAssistantTarget(state);
  const [pending, setPending] = useState<"pause" | "control" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [target?.bot.id, target?.mode, target?.held]);

  if (!target) return null;

  const pauseLocal = async () => {
    if (pending !== null) return;
    setPending("pause");
    setError(null);
    try {
      const response = await fetch("/api/local-computer/interrupt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.error === "string" ? body.error : t("localBar.pauseError"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("localBar.pauseError"));
    } finally {
      setPending(null);
    }
  };

  const toggleControl = async () => {
    if (pending !== null || target.heldByOther) return;
    const action: ComputerControlAction = target.held ? "release" : "take";
    setPending("control");
    setError(null);
    try {
      if (action === "release") {
        void window.ogb?.desktopViewer?.close(target.bot.id);
      }
      await transitionComputerControlLease({
        action,
        syncNativeBrowser: false,
        requestControl: async (nextAction) => {
          const raw = await api(`/api/bots/${target.bot.id}/computer/control`, {
            method: "POST",
            body: JSON.stringify({ action: nextAction }),
          });
          const snapshot = {
            held: raw?.held === true,
            heldByOther: raw?.heldByOther === true,
            helpReason: typeof raw?.helpReason === "string" ? raw.helpReason : null,
            help: parseComputerHelp(raw?.help),
          };
          dispatch({
            type: "computerControl",
            botId: target.bot.id,
            ...snapshot,
          });
          return snapshot;
        },
        setNativeBrowserControl: async () => true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("localBar.controlError"));
    } finally {
      setPending(null);
    }
  };

  const openComputerPanel = () => {
    writeComputerPanelView(target.bot.id, "computer");
    dispatch({ type: "select", id: target.bot.id });
    dispatch({ type: "toggleComputer", open: true, botId: target.bot.id });
  };

  return (
    <div
      role="status"
      data-local-assistant-bar={target.mode}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            target.held || target.helpReason
              ? "bg-warning"
              : "animate-pulse bg-success",
          )}
        />
        <Monitor size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="truncate font-medium text-ink">{statusCopy(target)}</span>
        {error && (
          <span role="alert" className="truncate text-[12px] text-danger">
            {error}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {target.mode === "local" ? (
          <>
            <button
              type="button"
              data-local-bar-action="pause"
              disabled={pending !== null}
              aria-busy={pending === "pause"}
              onClick={() => void pauseLocal()}
              className="inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-2.5 py-1 text-[12px] font-medium text-warning hover:bg-warning/25 disabled:opacity-50"
            >
              {pending === "pause" ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
              {t("localBar.pause")}
            </button>
            <button
              type="button"
              data-local-bar-action="view"
              onClick={openComputerPanel}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline/40 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-control"
            >
              <Eye size={12} />
              {t("localBar.view")}
            </button>
          </>
        ) : (
          <>
            {!target.heldByOther && (
              <button
                type="button"
                data-local-bar-action={target.held ? "release" : "take"}
                disabled={pending !== null}
                aria-busy={pending === "control"}
                onClick={() => void toggleControl()}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50",
                  target.held
                    ? "bg-control text-ink hover:bg-raised"
                    : "bg-accent/15 text-accent hover:bg-accent/25",
                )}
              >
                {pending === "control" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : target.held ? (
                  <Undo2 size={12} />
                ) : (
                  <Hand size={12} />
                )}
                {t(target.held ? "localBar.handBack" : "localBar.takeControl")}
              </button>
            )}
            <button
              type="button"
              data-local-bar-action="watch"
              onClick={openComputerPanel}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline/40 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-control"
            >
              <Eye size={12} />
              {t("localBar.watch")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
