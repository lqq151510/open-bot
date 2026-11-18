import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { localizeComputerProblem, runtimeDisplayName } from "@/lib/computer-messages";
import { t } from "@/lib/i18n";
import { Card, CommandLine } from "./SettingsPrimitives";

export type LocalVmAction = "pull" | "run" | "start" | "stop" | "remove" | "recreate" | "prepare-start";
export type PrepareStartStage = "pulling" | "starting" | null;

export interface LocalVmStatus {
  platform: string;
  runtime: string | null;
  available: string[];
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  image_ref: string;
  base_image_ref: string;
  driver_version: string;
  container_name: string;
  workspace_path: string;
  workspace_guest_path: string;
  viewer_url: string;
  idle_timeout_ms: number;
  stop_reason?: "idle" | null;
  mode: "shared" | "per-bot" | "pool";
  max_instances: number;
  commands: {
    install: string | null;
    runtimeStart: string | null;
    pull: string | null;
    run: string | null;
    start: string | null;
    stop: string | null;
    remove: string | null;
    view: string;
  };
}

export type HeroStateKind =
  | "checking"
  | "unavailable"
  | "no-runtime"
  | "daemon-down"
  | "per-bot-unsupported"
  | "needs-prepare"
  | "ready-per-bot"
  | "needs-recreate"
  | "ready"
  | "starting"
  | "stopped"
  | "not-started";

export function localVmNeedsRecreate(status: LocalVmStatus | null): boolean {
  if (!status || status.container === "missing") return false;
  return Boolean(
    !status.imageMatches ||
      !status.managed ||
      status.network === "unsafe" ||
      status.security === "unsafe" ||
      status.persistence === "unsafe",
  );
}

export function resolveHeroStateKind(status: LocalVmStatus | null, loading: boolean): HeroStateKind {
  if (loading && !status) return "checking";
  if (!status) return "unavailable";
  if (!status.runtime) return "no-runtime";
  if (!status.daemonUp) return "daemon-down";
  if (status.mode === "per-bot" && status.runtime === "container") return "per-bot-unsupported";
  if (!status.image) return "needs-prepare";
  if (status.mode === "per-bot") return "ready-per-bot";
  if (localVmNeedsRecreate(status)) return "needs-recreate";
  if (status.ready) return "ready";
  if (status.container === "running") return "starting";
  if (status.container === "stopped") return "stopped";
  return "not-started";
}

export function shouldExpandRemoteDesktops(input: {
  cloudConfigured: boolean | null;
  cloudCount: number;
  vpsConfigured: boolean | null;
  vpsCount: number;
}): boolean {
  return (
    input.cloudConfigured === true ||
    input.cloudCount > 0 ||
    input.vpsConfigured === true ||
    input.vpsCount > 0
  );
}

function heroSubtitle(platform: string | undefined): string {
  if (platform === "darwin") return t("vm.hero.subtitleMac");
  if (platform === "win32") return t("vm.hero.subtitleWindows");
  return t("vm.hero.subtitleDefault", { host: t("vm.host.computer") });
}

function runtimeNoticeTitle(platform: string | undefined): string {
  if (platform === "win32") return t("vm.main.runtimeNoticeWindows");
  if (platform === "darwin") return t("vm.main.runtimeNoticeMac");
  return t("vm.main.runtimeNotice");
}

function runtimeNoticeBody(status: LocalVmStatus, runtimeLabel: string | null): string {
  if (!status.runtime) {
    return status.platform === "win32"
      ? t("vm.main.noRuntimeHintWindows")
      : t("vm.main.noRuntimeHintMac");
  }
  return t("vm.main.daemonDownHint", { runtime: runtimeLabel ?? status.runtime });
}

export function LocalCloudComputerCard({
  status,
  loading,
  pending,
  prepareStage,
  error,
  onRecheck,
  onAction,
}: {
  status: LocalVmStatus | null;
  loading: boolean;
  pending: LocalVmAction | null;
  prepareStage: PrepareStartStage;
  error: string | null;
  onRecheck: () => void;
  onAction: (action: LocalVmAction) => void;
}) {
  const kind = resolveHeroStateKind(status, loading);
  const headerReady = kind === "ready" || kind === "ready-per-bot";
  const runtimeLabel = runtimeDisplayName(status?.runtime);
  const commands = status?.commands;
  const busy = pending !== null;

  const statusText = kind === "checking"
    ? t("common.checking")
    : kind === "unavailable"
      ? t("vm.main.statusUnavailable")
      : kind === "ready-per-bot"
        ? t("vm.main.readyPerBot")
        : kind === "per-bot-unsupported"
          ? t("vm.main.perBotUnsupported")
          : kind === "ready"
            ? t("vm.main.ready")
            : (localizeComputerProblem(status?.problem) ?? t("vm.main.notReady"));

  return (
    <Card title={t("vm.hero.title")} subtitle={heroSubtitle(status?.platform)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-live="polite"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px]",
            headerReady ? "bg-success/15 text-success" : "bg-control text-ink-secondary",
          )}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : headerReady ? <Check size={12} /> : <Circle size={9} />}
          {statusText}
        </span>

        {runtimeLabel && (
          <span
            data-testid="local-vm-runtime-badge"
            className="rounded-full bg-control px-2.5 py-0.5 text-[12px] font-medium text-ink-secondary"
          >
            {runtimeLabel}
          </span>
        )}

        <button
          type="button"
          onClick={onRecheck}
          disabled={loading || busy}
          className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={12} /> {t("vm.main.recheck")}
        </button>
      </div>

      {prepareStage && (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[13px] text-ink">
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
          <span>{t(prepareStage === "pulling" ? "vm.hero.preparing" : "vm.hero.starting")}</span>
        </div>
      )}

      {(kind === "no-runtime" || kind === "daemon-down") && status && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-ink/[0.04] p-3 text-[12px] text-ink-secondary">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-ink">{runtimeNoticeTitle(status.platform)}</p>
              <p className="mt-0.5">{runtimeNoticeBody(status, runtimeLabel)}</p>
            </div>
          </div>
          {!status.runtime ? (
            commands?.install ? (
              <CommandLine command={commands.install} />
            ) : (
              <a
                href={status.platform === "win32" ? "https://learn.microsoft.com/windows/wsl/install" : "https://docs.docker.com/desktop/"}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-accent hover:underline"
              >
                {status.platform === "win32" ? t("vm.setup.wslGuide") : t("vm.setup.dockerGuide")}
              </a>
            )
          ) : commands?.runtimeStart ? (
            <CommandLine command={commands.runtimeStart} />
          ) : (
            <p className="text-[12px] text-ink-secondary">
              {status.platform === "win32"
                ? t("vm.setup.step2DetailWindows")
                : status.platform === "darwin"
                  ? t("vm.setup.step2DetailMac")
                  : t("vm.setup.step2Detail")}
            </p>
          )}
        </div>
      )}

      {kind === "per-bot-unsupported" && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{t("vm.setup.applePort")}</p>
      )}

      {kind === "needs-prepare" && !prepareStage && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            aria-busy={pending === "prepare-start"}
            onClick={() => onAction("prepare-start")}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {pending === "prepare-start" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {t("vm.hero.prepareAndStart")}
          </button>
        </div>
      )}

      {kind === "needs-recreate" && status && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <div className="flex gap-2 text-[13px] text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{localizeComputerProblem(status.problem)}</span>
          </div>
          {status.image && (
            <button
              type="button"
              disabled={busy}
              aria-busy={pending === "recreate"}
              onClick={() => onAction("recreate")}
              className="flex items-center gap-1.5 rounded-lg bg-danger/15 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
            >
              {pending === "recreate" ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              {t("vm.setup.recreate")}
            </button>
          )}
        </div>
      )}

      {(kind === "stopped" || kind === "not-started") && !prepareStage && status && (
        <div className="mt-3 flex flex-col items-start gap-2.5">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {kind === "stopped"
              ? t(status.stop_reason === "idle" ? "vm.stopped.idle" : "vm.stopped.detail")
              : t("vm.setup.idleHint")}
          </p>
          <button
            type="button"
            disabled={busy}
            aria-busy={pending === "start" || pending === "run"}
            onClick={() => onAction(kind === "stopped" ? "start" : "run")}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {pending === "start" || pending === "run" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {t(kind === "stopped" ? "vm.hero.wake" : "vm.hero.start")}
          </button>
        </div>
      )}

      {kind === "starting" && !prepareStage && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
          <Loader2 size={13} className="animate-spin" /> {t("vm.setup.waiting")}
        </div>
      )}

      {kind === "ready" && status && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href={status.viewer_url || commands?.view}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:brightness-110"
          >
            <ExternalLink size={13} /> {t("vm.main.watch")}
          </a>
          <button
            type="button"
            disabled={busy}
            aria-busy={pending === "stop"}
            onClick={() => onAction("stop")}
            className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
          >
            {pending === "stop" ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} />}
            {t("vm.hero.stopSleep")}
          </button>
        </div>
      )}

      {kind === "ready-per-bot" && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{t("vm.setup.perBotHint")}</p>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {localizeComputerProblem(error) ?? error}
        </div>
      )}
    </Card>
  );
}

export function OtherRemoteDesktopsDisclosure({
  cloudConfigured,
  cloudCount,
  vpsConfigured,
  vpsCount,
  children,
}: {
  cloudConfigured: boolean | null;
  cloudCount: number;
  vpsConfigured: boolean | null;
  vpsCount: number;
  children?: ReactNode;
}) {
  const autoOpen = shouldExpandRemoteDesktops({
    cloudConfigured,
    cloudCount,
    vpsConfigured,
    vpsCount,
  });
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? autoOpen;

  return (
    <details
      open={open}
      data-testid="other-remote-desktops"
      className="rounded-xl border border-hairline/40 bg-panel/40 p-3"
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setManualOpen(!open);
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-1 text-[14px] font-medium text-ink select-none hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <span>
          <span className="block">{t("vm.hero.otherRemote")}</span>
          <span className="block text-[12px] font-normal text-ink-secondary">
            {t("vm.hero.otherRemoteHint")}
          </span>
        </span>
        <ChevronRight
          size={15}
          aria-hidden="true"
          className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-90")}
        />
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}
