import { useState } from "react";

import { LIVE_VOICE_OPTIONS } from "../../../shared/live-call";
import type { LiveSettings } from "../../../shared/wire";
import { t } from "@/lib/i18n";
import { setLivePlaybackRate } from "@/lib/live-call-media";
import { api, useStore } from "@/state/store";
import { Select } from "../Select";
import { Card } from "./rows";

const SPEEDS = [0.75, 1, 1.25, 1.5];

export function VoiceChatSummary() {
  const { state, dispatch } = useStore();
  const live: LiveSettings = state.config?.live ?? {
    configured: false,
    voice: "",
    voiceSpeed: 1,
    voiceLanguage: "auto",
    readTypedReplies: true,
    idleMinutes: 5,
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<Pick<LiveSettings, "voice" | "voiceSpeed" | "voiceLanguage">>) => {
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ live: LiveSettings }>("/api/live/settings", { method: "PATCH", body: JSON.stringify(patch) });
      if (state.config) dispatch({ type: "configStatus", config: { ...state.config, live: body.live } });
      if (patch.voiceSpeed !== undefined) setLivePlaybackRate(body.live.voiceSpeed);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card label={t("call.live.voiceChat")} anchor="voice-chat">
      <div className="px-3.5">
        <label className="flex min-h-[42px] items-center justify-between gap-3 border-b border-ink/[0.05] text-[14px] font-medium text-ink">
          <span>{t("call.live.voice")}</span>
          <Select size="sm" className="max-w-[58%]" value={live.voice || "marin"} disabled={saving} aria-label={t("call.live.voice")} onChange={(event) => void save({ voice: event.target.value })}>
            {LIVE_VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        </label>
        <label className="flex min-h-[42px] items-center justify-between gap-3 border-b border-ink/[0.05] text-[14px] font-medium text-ink">
          <span>{t("call.live.speed")}</span>
          <Select size="sm" className="max-w-[58%]" value={live.voiceSpeed} disabled={saving} aria-label={t("call.live.speed")} onChange={(event) => void save({ voiceSpeed: Number(event.target.value) })}>
            {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
          </Select>
        </label>
        <label className="flex min-h-[42px] items-center justify-between gap-3 py-1 text-[14px] font-medium text-ink">
          <span>{t("call.live.language")}</span>
          <Select size="sm" className="max-w-[58%]" value={live.voiceLanguage} disabled={saving} aria-label={t("call.live.language")} onChange={(event) => void save({ voiceLanguage: event.target.value as LiveSettings["voiceLanguage"] })}>
            <option value="auto">{t("call.live.languageAuto")}</option>
            <option value="en">{t("call.live.languageEnglish")}</option>
            <option value="zh">{t("call.live.languageChinese")}</option>
          </Select>
        </label>
      </div>
      {error && <p role="alert" className="px-3.5 pb-3 text-[12px] text-danger">{error}</p>}
    </Card>
  );
}
