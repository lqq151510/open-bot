import { useContext, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, StoreContext, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { t } from "@/lib/i18n";

export function BotChip({
  botId,
  botName,
  children,
}: {
  botId?: string;
  botName?: string;
  children?: ReactNode;
}) {
  const store = useContext(StoreContext);
  const showThreads = useShowThreads();
  const bot: Pick<Bot, "id" | "name" | "color"> | undefined =
    (botId ? store?.state?.bots?.find((b) => b.id === botId) : undefined)
    ?? (botName ? store?.state?.bots?.find((b) => b.name.toLowerCase() === botName.trim().toLowerCase()) : undefined)
    ?? (botId || botName ? { id: botId ?? botName!, name: botName ?? botId!, color: "purple" } : undefined);

  if (!bot) {
    return <span className="inline-flex items-center gap-1 font-medium">{children ?? botName}</span>;
  }

  const colorHex = (bot.color && Object.hasOwn(MAUS_COLORS, bot.color as MausColor))
    ? MAUS_COLORS[bot.color as MausColor]
    : MAUS_COLORS.purple;

  return (
    <button
      type="button"
      data-bot-chip={bot.id}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (store?.dispatch) {
          const fullBot = store.state.bots.find((b) => b.id === bot.id);
          if (fullBot) openBot(store.dispatch, fullBot, showThreads);
        }
      }}
      aria-label={t("chat.openProfileAria", { name: bot.name })}
      title={t("chat.openProfileAria", { name: bot.name })}
      className={cn(
        "group mx-0.5 inline-flex items-center gap-1.5 align-baseline rounded-full px-2 py-0.5 text-[14px] font-medium transition-all hover:bg-ink/[0.06] active:scale-95 cursor-pointer",
      )}
      style={{
        color: colorHex,
      }}
    >
      <span className="shrink-0 inline-flex items-center">
        <BotAvatar bot={bot as Bot} size={15} animated={false} />
      </span>
      <span className="truncate">{bot.name}</span>
    </button>
  );
}
