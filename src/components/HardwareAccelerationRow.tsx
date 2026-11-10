import { useEffect, useState } from "react";

import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { HardwareAccelerationState } from "../../electron/desktop-prefs.mjs";
import { SettingRow, Switch } from "./SettingsPrimitives";

/** Settings' switch for the GPU process: Electron fixes it before the app is ready, so the row says a change lands on the
 * next start, with a way to restart where this page may. */
export function HardwareAccelerationRow() {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.hardwareAcceleration;
  const [state, setState] = useState<HardwareAccelerationState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.state().then((next) => { if (alive) setState(next); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);
  if (!bridge || !state || state.available === false) return null;
  const relaunch = window.ogb?.relaunch;
  const toggle = () => void bridge.set(!state.on).then(setState).catch(() => {});
  return <div data-hardware-acceleration-switch>
    <SettingRow title={t("settings.system.hardwareAcceleration")}>
      <Switch checked={state.on} aria-label={t("settings.system.hardwareAcceleration")} onClick={toggle} />
    </SettingRow>
    {state.restart && <div role="status" data-hardware-acceleration-restart className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-[13px] text-ink-secondary">
      <span>{t("settings.hardwareAcceleration.restart", { app: productName() })}</span>
      {relaunch && <button type="button" className="ui-button" onClick={() => void relaunch().catch(() => {})}>{t("settings.hardwareAcceleration.restartNow")}</button>}
    </div>}
  </div>;
}
