import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const INPUT_CLASS = "w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50";
const PROVIDER_LABEL = { openai: "OpenAI", xai: "Grok (xAI)", gemini: "Gemini", openrouter: "OpenRouter", custom: "Custom" } as const;

export function AvatarImageGenerator({
  botLabel,
  disabled,
  generating,
  onGenerate,
  compact = false,
}: {
  botLabel: string;
  disabled: boolean;
  generating: boolean;
  onGenerate: (direction: string) => Promise<void>;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const imageGen = state.config?.imageGen;
  const [direction, setDirection] = useState("");
  const busy = disabled || generating;
  const ready = imageGen?.ready ?? imageGen?.configured === true;
  const canGenerate = !busy && ready && (!compact || direction.trim().length > 0);
  const primary = imageGen?.primary ?? (imageGen?.provider ? { provider: imageGen.provider, configured: imageGen.configured } : null);
  const inUse = primary?.configured ? primary.provider : imageGen?.fallback?.configured ? imageGen.fallback.provider : null;

  return (
    <div className={compact ? "" : "mt-5 border-t border-hairline/40 pt-4"}>
      {!compact && <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Sparkles size={14} className="text-accent" /> {t("botIdentity.ai.generateWith")}
      </div>}
      <p className={cn("text-[11px] leading-relaxed text-ink-secondary", compact ? "mb-2" : "mt-1.5")}>
        {ready && inUse ? t("botIdentity.ai.usingProvider", { provider: PROVIDER_LABEL[inUse] }) : t("botIdentity.ai.noProvider")}{" "}
        <button
          type="button"
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "imageGeneration" })}
          className="cursor-pointer text-accent hover:underline"
        >
          {t("botIdentity.ai.openImageSettings")}
        </button>
      </p>

      <textarea
        value={direction}
        disabled={busy || !ready}
        onChange={(event) => setDirection(event.target.value.slice(0, 400))}
        maxLength={400}
        placeholder={compact ? t("botPanel.avatar.describe") : t("botIdentity.ai.directionPlaceholder", { name: botLabel })}
        aria-label={t("botIdentity.ai.directionLabel")}
        className={cn(INPUT_CLASS, compact ? "min-h-[160px] resize-y" : "mt-3 min-h-[72px] resize-none")}
      />
      <div className={cn("mt-2 flex items-center gap-3", !compact && "justify-between")}>
        <span className={compact ? "sr-only" : "text-[11px] tabular-nums text-ink-secondary"}>{direction.length}/400</span>
        <button
          type="button"
          onClick={() => {
            if (canGenerate) void onGenerate(direction.trim());
          }}
          disabled={!canGenerate}
          className={cn("flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium hover:brightness-110 disabled:opacity-50", compact ? "w-full bg-ink text-app" : "bg-accent text-white")}
        >
          {generating ? <Loader2 size={13} className="animate-spin" /> : !compact && <Sparkles size={13} />}
          {generating ? t("botIdentity.ai.generating") : compact ? t("botPanel.avatar.generate") : t("botIdentity.ai.generate")}
        </button>
      </div>
    </div>
  );
}
