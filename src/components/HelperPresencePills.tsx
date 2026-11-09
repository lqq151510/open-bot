import { memo, useMemo } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BotAvatar } from "@/components/Avatar";
import type { Bot, Message } from "@/state/store";

export interface ActiveHelperBot {
  id: string;
  name: string;
  bot?: Bot;
  icon?: string;
  statusText: string;
  onClick?: () => void;
}

function deriveHelperIcon(name: string, statusText: string): string {
  const combined = `${name} ${statusText}`.toLowerCase();
  if (combined.includes("search") || combined.includes("搜") || combined.includes("find") || combined.includes("检索")) return "🔍";
  if (combined.includes("code") || combined.includes("审查") || combined.includes("review") || combined.includes("git")) return "💻";
  if (combined.includes("data") || combined.includes("数") || combined.includes("table") || combined.includes("sql")) return "📊";
  if (combined.includes("doc") || combined.includes("文") || combined.includes("write") || combined.includes("写")) return "📝";
  if (combined.includes("web") || combined.includes("browser") || combined.includes("浏览")) return "🌐";
  return "🤖";
}

function deriveHelperStatus(bot?: Bot, fallbackText?: string): string {
  if (fallbackText) return fallbackText;
  if (!bot) return t("chat.activity.working");
  if (bot.activity === "working") return t("chat.activity.working");
  return t("chat.friendly.thinking");
}

export function useActiveHelpers({
  currentBot,
  allBots = [],
  messages = [],
}: {
  currentBot?: Bot;
  allBots?: readonly Bot[];
  messages?: readonly Message[];
}): ActiveHelperBot[] {
  return useMemo(() => {
    const helpers: ActiveHelperBot[] = [];
    if (!currentBot) return helpers;

    // Detect helpers delegated via recent messages or waitingForTeammates
    const recentDelegate = messages
      .slice(-6)
      .reverse()
      .find((m) => m.tool && (m.tool.name === "delegate_bot" || m.tool.name === "ask_bot" || m.tool.name.includes("agent")));

    if (recentDelegate?.tool) {
      const summary = recentDelegate.tool.summary || recentDelegate.tool.input || "";
      let targetName = "";
      try {
        const parsed = JSON.parse(recentDelegate.tool.input ?? "{}");
        targetName = parsed.botName || parsed.name || parsed.target || "";
      } catch {
        // non-JSON input
      }

      const matchedBot = allBots.find((b) => b.id !== currentBot.id && (b.name === targetName || summary.includes(b.name)));
      const name = matchedBot?.name || targetName || t("chat.assistant");
      const statusText = summary.includes("检索") || summary.includes("search")
        ? "正在检索文档..."
        : summary.includes("分析") || summary.includes("analyze")
          ? "正在分析数据..."
          : summary.includes("审查") || summary.includes("review")
            ? "正在审查代码..."
            : "正在协同处理任务...";

      helpers.push({
        id: matchedBot?.id || `delegate-${recentDelegate.id}`,
        name,
        bot: matchedBot,
        icon: deriveHelperIcon(name, statusText),
        statusText,
      });
    }

    // Detect teammate bots actively working while current bot is waiting on them
    if (currentBot.waitingForTeammates) {
      const busyTeammates = allBots.filter((b) => b.id !== currentBot.id && (b.busy || b.activity === "working"));
      for (const teammate of busyTeammates) {
        if (!helpers.some((h) => h.id === teammate.id)) {
          const statusText = deriveHelperStatus(teammate, "正在协同处理任务...");
          helpers.push({
            id: teammate.id,
            name: teammate.name,
            bot: teammate,
            icon: deriveHelperIcon(teammate.name, statusText),
            statusText,
          });
        }
      }

      if (helpers.length === 0) {
        helpers.push({
          id: `helper-generic-${currentBot.id}`,
          name: "搜索与协同助手",
          icon: "🔍",
          statusText: "正在检索与协同处理...",
        });
      }
    }

    return helpers;
  }, [currentBot, allBots, messages]);
}

export const HelperPresencePills = memo(function HelperPresencePills({
  helpers,
  className,
}: {
  helpers: readonly ActiveHelperBot[];
  className?: string;
}) {
  if (!helpers || helpers.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 mb-2 px-1 py-0.5 pointer-events-auto transition-all duration-300 ease-out",
        className,
      )}
      data-testid="helper-presence-pills"
    >
      {helpers.map((helper) => {
        const icon = helper.icon || deriveHelperIcon(helper.name, helper.statusText);
        return (
          <div
            key={helper.id}
            onClick={helper.onClick}
            className={cn(
              "group inline-flex items-center gap-2 rounded-full px-3 py-1.5",
              "bg-panel/85 backdrop-blur-md border border-hairline/60 shadow-sm hover:shadow-md",
              "text-[12px] text-ink transition-all duration-300 ease-out select-none",
              helper.onClick && "cursor-pointer hover:border-accent/40",
            )}
          >
            <span className="relative flex size-2 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>

            {helper.bot ? (
              <span className="shrink-0 size-4 flex items-center justify-center">
                <BotAvatar bot={helper.bot} size={16} motion="none" animated={false} />
              </span>
            ) : (
              <span className="text-[13px] leading-none shrink-0" aria-hidden="true">
                {icon}
              </span>
            )}

            <span className="font-semibold tracking-tight text-ink min-w-0 truncate max-w-[120px]">
              {helper.name}
            </span>

            <span className="text-ink-tertiary">·</span>

            <span className="relative overflow-hidden font-medium text-ink-secondary/90 min-w-0 truncate max-w-[200px]">
              {helper.statusText}
            </span>
          </div>
        );
      })}
    </div>
  );
});
