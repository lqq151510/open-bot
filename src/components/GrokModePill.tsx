import { Flame, Brain, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface GrokModePillProps {
  fun: boolean;
  onToggleFun: () => void;
  think?: boolean;
  onToggleThink?: () => void;
  thinkDisabled?: boolean;
  className?: string;
}

export function GrokModePill({
  fun,
  onToggleFun,
  think,
  onToggleThink,
  thinkDisabled = false,
  className,
}: GrokModePillProps) {
  const thinkTitle = thinkDisabled
    ? t("grokMode.think.busy")
    : think
      ? t("model.effort.noLevel")
      : t("model.effort.ask", { level: t("model.effort.high") });

  return (
    <div className={cn("flex items-center gap-1 text-[12px]", className)} data-testid="grok-mode-pill">
      <button
        type="button"
        onClick={onToggleFun}
        title={fun ? t("grokMode.fun.remove") : t("grokMode.fun.add")}
        aria-label={fun ? t("grokMode.fun.remove") : t("grokMode.fun.add")}
        aria-pressed={fun}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-all duration-200 select-none",
          fun
            ? "border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.15)] hover:bg-amber-500/20"
            : "border border-hairline/40 bg-control/40 text-ink-secondary hover:bg-control hover:text-ink",
        )}
      >
        {fun ? (
          <Flame size={13} className="text-amber-400 animate-pulse" />
        ) : (
          <Sparkles size={13} className="text-ink-tertiary" />
        )}
        <span className="tracking-tight">{fun ? t("grokMode.fun.label") : t("grokMode.normal.label")}</span>
      </button>

      {think !== undefined && onToggleThink && (
        <button
          type="button"
          onClick={onToggleThink}
          disabled={thinkDisabled}
          title={thinkTitle}
          aria-label={thinkTitle}
          aria-pressed={think}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-all duration-200 select-none",
            thinkDisabled && "cursor-default opacity-50",
            think
              ? "border border-accent/40 bg-accent/15 text-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:bg-accent/25"
              : "border border-hairline/40 bg-control/40 text-ink-secondary hover:bg-control hover:text-ink",
          )}
        >
          <Brain size={13} className={think ? "text-accent" : "text-ink-tertiary"} />
          <span className="tracking-tight">{t("grokMode.think.label")}</span>
        </button>
      )}
    </div>
  );
}
