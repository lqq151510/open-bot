import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { SYSTEM_MICROPHONE, setMicrophone, useMicrophone } from "@/lib/microphone-preference";
import { SettingRow } from "./SettingsPrimitives";
import { Select } from "./Select";

type MicrophoneOption = { id: string; label: string };

/** Labels stay blank until the browser grants capture, so unnamed inputs fall back to their order. */
async function listMicrophones(): Promise<MicrophoneOption[]> {
  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.enumerateDevices) return [];
  try {
    const listed = await devices.enumerateDevices();
    return listed
      .filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== SYSTEM_MICROPHONE)
      .map((device, index) => ({ id: device.deviceId, label: device.label || t("settings.microphone.device", { index: index + 1 }) }));
  } catch {
    return [];
  }
}

export function MicrophoneRow() {
  const chosen = useMicrophone();
  const [devices, setDevices] = useState<MicrophoneOption[]>([]);
  useEffect(() => {
    let live = true;
    void listMicrophones().then((next) => { if (live) setDevices(next); });
    return () => { live = false; };
  }, []);
  const options = devices.some((device) => device.id === chosen) || chosen === SYSTEM_MICROPHONE
    ? devices
    : [...devices, { id: chosen, label: t("settings.microphone.unavailable") }];
  return (
    <SettingRow title={t("settings.microphone.title")}>
      <Select size="sm" variant="ghost" value={chosen} aria-label={t("settings.microphone.title")} onChange={(event) => setMicrophone(event.target.value)}>
        <option value={SYSTEM_MICROPHONE}>{t("settings.microphone.systemDefault")}</option>
        {options.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
      </Select>
    </SettingRow>
  );
}
