import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import type { LocaleKey } from "@/locales";
import type { ComputerImageUpdates as ImageUpdates } from "../../shared/computer-image-updates";
import type { DeviceAccessPatch, DeviceAccessState, DeviceExecution } from "../../shared/device-access";
import { Select } from "./Select";
import { SettingRow, SettingsRows, Switch } from "./SettingsPrimitives";

const imageLabels = {
  current: "settings.computer.image.current",
  ready: "settings.computer.image.ready",
  busy: "settings.computer.image.busy",
  waiting: "settings.computer.image.waiting",
  unavailable: "settings.computer.image.unavailable",
} satisfies Record<ImageUpdates["status"], LocaleKey>;

export function ComputerImageUpdates() {
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<ImageUpdates | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void api<ImageUpdates>("/api/computers/image-updates", { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result && Array.isArray(result.computers) && Object.hasOwn(imageLabels, result.status)) setData(result);
        else { setData(null); setFailed(true); }
      },
      () => {
        if (controller.signal.aborted) return;
        setData(null);
        setFailed(true);
      },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const summary = loading ? t("settings.computer.image.checking")
    : failed || !data ? t("settings.computer.image.failed")
      : t(imageLabels[data.status]);

  const isUpToDate = !loading && data && (data.status === "current" || data.status === "unavailable");
  const isPending = !loading && data && (data.status === "ready" || data.status === "busy" || data.status === "waiting");

  return (
    <SettingsRows>
      <SettingRow
        title={t("settings.computer.updateBotsComputer")}
        subtitle={t("settings.computer.updateBotsComputerSubtitle")}
        message={!loading && data?.unverified ? t("settings.computer.image.partial") : undefined}
      >
        <button
          type="button"
          className="ui-button"
          disabled={loading}
          onClick={() => { setLoading(true); setFailed(false); setRefresh((value) => value + 1); }}
        >
          {t("settings.computer.image.check")}
        </button>
      </SettingRow>

      {isUpToDate && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-sky-200/60 bg-sky-50/80 px-3.5 py-2.5 text-[13px] font-medium text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300">
          <CheckCircle2 size={16} className="shrink-0 text-sky-600 dark:text-sky-400" />
          <span>{t("settings.computer.upToDate")}</span>
        </div>
      )}

      {isPending && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-ink/[0.04] px-3.5 py-2.5 text-[13px] text-ink">
          <span>{summary}</span>
        </div>
      )}

      {!loading && Boolean(data?.computers.length) && (
        <ul className="space-y-1 px-4 pb-3">
          {data?.computers.map((computer) => (
            <li key={`${computer.provider}:${computer.id}`} className="flex gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words text-ink">{computer.name}</span>
              <span className="text-right text-ink-secondary">{t(imageLabels[computer.status])}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsRows>
  );
}

export function ComputerExecutionRows() {
  const bridge = typeof window !== "undefined" ? window.ogb?.deviceAccess : undefined;
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<DeviceAccessState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.state().then(
      (result) => { if (active) setData(result); },
      () => { if (active) setLoadFailed(true); },
    );
    return () => { active = false; };
  }, [bridge, retry]);

  const save = async (patch: DeviceAccessPatch) => {
    if (!bridge || pending) return;
    setPending(true);
    setSaveFailed(false);
    try {
      setData(await bridge.set(patch));
    } catch {
      setSaveFailed(true);
    } finally {
      setPending(false);
    }
  };

  if (!bridge || !data) return (
    <SettingsRows>
      <SettingRow title={t("settings.computer.deviceSettings")}
        subtitle={t(!bridge ? "settings.computer.desktopSettingsOnly"
          : loadFailed ? "settings.computer.deviceLoadFailed" : "settings.computer.deviceLoading")}>
        {bridge && loadFailed ? (
          <button type="button" className="ui-button"
            onClick={() => { setLoadFailed(false); setRetry((value) => value + 1); }}>
            {t("commandAllowlist.retry")}
          </button>
        ) : null}
      </SettingRow>
    </SettingsRows>
  );

  return (
    <SettingsRows>
      <SettingRow title={t("settings.computer.executeOnThis")} subtitle={t("settings.computer.executeOnThisSubtitle")}>
        <Select size="sm" value={data.execution} disabled={pending}
          onChange={(event) => void save({ execution: event.target.value as DeviceExecution })}
          aria-label={t("settings.computer.executeOnThis")}>
          <option value="always">{t("settings.computer.alwaysAllow")}</option>
          <option value="ask">{t("settings.computer.askEveryTime")}</option>
          <option value="never">{t("settings.computer.neverAllow")}</option>
        </Select>
      </SettingRow>
      <SettingRow title={t("settings.computer.forwardTraffic")} subtitle={t("settings.computer.forwardTrafficSubtitle", { count: 0 })}>
        <Switch checked={data.forwardTraffic} disabled={pending}
          aria-label={t("settings.computer.forwardTraffic")}
          onClick={() => void save({ forwardTraffic: !data.forwardTraffic })} />
      </SettingRow>
      {saveFailed && <p role="alert" className="px-4 pb-3 text-[13px] text-danger">{t("settings.computer.deviceSaveFailed")}</p>}
    </SettingsRows>
  );
}
