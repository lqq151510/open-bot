import { Flame, Brain, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GrokPersonaMode } from "@/lib/grok-mode";

export interface GrokModePillProps {
  mode: GrokPersonaMode;
  onToggleMode: () => void;
  think: boolean;
  onToggleThink: () => void;
  className?: string;
}

export function GrokModePill({
  mode,
  onToggleMode,
  think,
  onToggleThink,
  className,
}: GrokModePillProps) {
  const isFun = mode === "fun";

  return (
    <div className={cn("flex items-center gap-1 text-[12px]", className)} data-testid="grok-mode-pill">
      {/* Fun / Normal mode switch */}
      <button
        type="button"
        onClick={onToggleMode}
        title={isFun ? "Grok 模式：幽默机智 (Fun Mode) - 点击切换为严谨模式" : "Grok 模式：严谨专业 (Normal Mode) - 点击切换为幽默机智模式"}
        aria-label={isFun ? "Switch to Normal mode" : "Switch to Fun mode"}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-all duration-200 select-none",
          isFun
            ? "border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.15)] hover:bg-amber-500/20"
            : "border border-hairline/40 bg-control/40 text-ink-secondary hover:bg-control hover:text-ink",
        )}
      >
        {isFun ? (
          <Flame size={13} className="text-amber-400 animate-pulse" />
        ) : (
          <Sparkles size={13} className="text-ink-tertiary" />
        )}
        <span className="tracking-tight">{isFun ? "Fun" : "Normal"}</span>
      </button>

      {/* Think / Extended Reasoning switch */}
      <button
        type="button"
        onClick={onToggleThink}
        title={think ? "深度思考模式已开启 (Think Mode On) - 点击关闭" : "深度思考模式已关闭 (Think Mode Off) - 点击开启思维链"}
        aria-label={think ? "Turn off Think mode" : "Turn on Think mode"}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-all duration-200 select-none",
          think
            ? "border border-accent/40 bg-accent/15 text-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:bg-accent/25"
            : "border border-hairline/40 bg-control/40 text-ink-secondary hover:bg-control hover:text-ink",
        )}
      >
        <Brain size={13} className={think ? "text-accent" : "text-ink-tertiary"} />
        <span className="tracking-tight">Think</span>
      </button>
    </div>
  );
}
