import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { WorkingDots } from "./WorkingIndicator";

export interface GrokThinkingBubbleProps {
  thought: string;
  inProgress?: boolean;
  durationMs?: number;
  className?: string;
}

/**
 * Grok 3-inspired Thinking / Reasoning process card.
 * Displays an expandable accordion with shimmer effect while in-progress,
 * collapsing into a sleek badge upon turn completion.
 */
export function GrokThinkingBubble({
  thought,
  inProgress = false,
  className,
}: GrokThinkingBubbleProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? inProgress;

  const cleanThought = thought.trim();
  if (!cleanThought && !inProgress) return null;
  const thinking = t("chat.reasoning.thinking");

  return (
    <div
      className={cn(
        "grok-thinking-card my-2 max-w-full overflow-hidden rounded-xl border border-hairline/40 bg-inset/50 text-[13px] transition-all duration-200",
        inProgress && "border-accent/30 shadow-[0_0_12px_rgba(255,255,255,0.05)]",
        className,
      )}
      data-testid="grok-thinking-bubble"
    >
      <button
        type="button"
        onClick={() => setUserExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left select-none hover:bg-raised/40 focus-visible:outline-2 focus-visible:outline-accent",
          inProgress ? "text-ink" : "text-ink-secondary",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md bg-control/60",
            inProgress && "text-accent animate-pulse",
          )}
          aria-hidden="true"
        >
          {inProgress ? <WorkingDots size={3} /> : <Sparkles size={12} className="text-ink-secondary" />}
        </span>

        <span className="flex items-center gap-1.5 font-medium tracking-tight">
          {inProgress ? (
            <span className="thinking-shimmer font-medium">
              {thinking}
              <span aria-hidden="true" className="thinking-sheen">
                <span data-text={thinking} />
              </span>
            </span>
          ) : (
            <span>{t("chat.reasoning.title")}</span>
          )}
        </span>

        <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-tertiary">
          <span>{t(expanded ? "chat.reasoning.collapse" : "chat.reasoning.expand")}</span>
          <ChevronRight
            size={13}
            className={cn(
              "shrink-0 transition-transform duration-200 ease-out",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-hairline/30 bg-inset/30 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-secondary">
          <div className="max-h-80 overflow-y-auto font-mono whitespace-pre-wrap break-words opacity-90">
            {cleanThought || (inProgress ? t("chat.reasoning.synthesizing") : "")}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Utility to parse <think>...</think> or <thought>...</thought> from model text streams.
 */
export function extractThinkingBlock(raw: string): { thought: string | null; inProgress: boolean; content: string } {
  const thinkOpenIdx = raw.search(/<(?:think|thought)>/i);
  if (thinkOpenIdx === -1) {
    return { thought: null, inProgress: false, content: raw };
  }

  const openTagMatch = raw.match(/<(?:think|thought)>/i);
  if (!openTagMatch) return { thought: null, inProgress: false, content: raw };

  const tagLen = openTagMatch[0].length;
  const afterOpen = raw.slice(thinkOpenIdx + tagLen);
  const closeTagMatch = afterOpen.match(/<\/(?:think|thought)>/i);

  const before = raw.slice(0, thinkOpenIdx);

  if (!closeTagMatch || closeTagMatch.index === undefined) {
    // Tag is not closed yet (model is actively streaming reasoning)
    return {
      thought: afterOpen,
      inProgress: true,
      content: before,
    };
  }

  const thought = afterOpen.slice(0, closeTagMatch.index);
  const after = afterOpen.slice(closeTagMatch.index + closeTagMatch[0].length);

  const trimmedBefore = before.trim();
  const trimmedAfter = after.trim();
  const combinedContent = [trimmedBefore, trimmedAfter].filter(Boolean).join("\n\n");

  return {
    thought,
    inProgress: false,
    content: combinedContent,
  };
}
