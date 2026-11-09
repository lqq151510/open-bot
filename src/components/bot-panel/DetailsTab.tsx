import { useState } from "react";
import { Calendar, ChevronRight, Monitor, Slack, Sparkles } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { appendComposerDraft } from "@/lib/drafts";
import { routineFinished, routineNextLabel } from "@/lib/routine-display";
import { useStore, type Bot } from "@/state/store";
import { useChatMoreItems } from "../ChatMoreMenu";
import { ModelPicker } from "../ModelPicker";
import type { SidebarMenuItem } from "../SidebarPopoverMenu";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { BotConversations } from "./Conversations";
import { useOpenComputer } from "./ComputerTab";
import { Switch } from "../SettingsPrimitives";
import type { SimplePageId } from "./page-registry";
import { TryAsking } from "./TryAsking";
import { Card, LabelAction, NavRow, RowIcon, rowCls, RowText } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export const CONVERSATION_ITEMS = ["find", "usage", "activity"];

/** A ⋯ menu item drawn as a panel row: the same label, icon, value and handler. */
export function ItemRow({ item }: { item: SidebarMenuItem }) {
  // Only the usage value is long text that should wrap; shortcuts and other values keep their full width.
  const wrapsValue = item.key === "usage";
  return (
    <button
      type="button"
      data-panel-item={item.key}
      disabled={item.disabled}
      aria-pressed={item.active || undefined}
      onClick={item.onSelect}
      className={cn(rowCls, "w-full text-left enabled:hover:bg-ink/[0.03] disabled:cursor-default disabled:opacity-45")}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-secondary [&_svg]:size-[15px]" aria-hidden="true">
        {item.icon}
      </span>
      <span className={cn("min-w-0 truncate text-[14px] font-medium", !wrapsValue && "flex-1", item.active ? "text-accent-text" : "text-ink")}>{item.label}</span>
      {item.trailing && <span className={cn("flex items-center", wrapsValue ? "min-w-0 flex-1 justify-end text-right" : "shrink-0")}>{item.trailing}</span>}
    </button>
  );
}

export function DetailsTab({ bot, derived, onOpen, slackUrl }: {
  bot: Bot;
  derived: Derived;
  onOpen: (page: SimplePageId) => void;
  slackUrl?: string | null;
}) {
  const [hiddenSuggestions, setHiddenSuggestions] = useState<string[]>([]);
  const { items } = useChatMoreItems(bot);
  const { dispatch } = useStore();
  const openComputer = useOpenComputer(bot);
  const routinesOn = derived.botRoutines.filter((routine) => routine.enabled).length;
  const conversationItems = CONVERSATION_ITEMS.flatMap((key) => items.filter((item) => item.key === key));

  return (
    <div data-panel-tabpanel="details">
      <Card anchor="model">
        <div data-panel-row="model" className={rowCls}>
          <ModelPicker
            bot={bot}
            contained
            threadId={bot.threadId}
            label={<span className="flex min-w-0 flex-1 items-center gap-2.5"><RowIcon icon={Sparkles} /><RowText title={t("model.simple.model")} /></span>}
          />
        </div>
      </Card>

      <BotConversations bot={bot} />

      {derived.botRoutines.length === 0 && hiddenSuggestions.includes(bot.id) ? (
        <div data-panel-empty="routines" className="px-3 py-7 text-center text-[13px] leading-[18px] text-ink-tertiary">
          <p>{t("botPanel.routines.empty")}</p>
          <button
            type="button"
            data-panel-page="routines"
            onClick={() => onOpen("routines")}
            className="mt-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-medium text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
          >
            {t("botPanel.routines.add")}
          </button>
        </div>
      ) : derived.botRoutines.length > 0 ? (
        <Card label={t("botSettings.simple.routines")} anchor="routines">
          {[...derived.botRoutines]
            .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name))
            .slice(0, 3)
            .map((routine) => (
              <div key={routine.id} data-panel-routine={routine.id} className={cn(rowCls, "min-w-0")}>
                <RowIcon icon={Calendar} />
                <button type="button" onClick={() => onOpen("routines")} className="min-w-0 flex-1 text-left hover:text-accent-text">
                  <span className="block truncate text-[14px] font-medium">{routine.name}</span>
                  <span className="block text-[12px] text-ink-secondary">{routineNextLabel(routine)}</span>
                </button>
                {!routineFinished(routine) && <Switch checked={routine.enabled} aria-label={t("routines.toggle", { name: routine.name })}
                  onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } })} />}
              </div>
            ))}
          <NavRow
            data-panel-page="routines"
            icon={Calendar}
            title={t("botSettings.simple.routines")}
            value={routinesOn > 0 ? t("botPanel.routinesOn", { count: routinesOn }) : t("botPanel.none")}
            onClick={() => onOpen("routines")}
          />
        </Card>
      ) : null}

      {!hiddenSuggestions.includes(bot.id) && (slackUrl || derived.botRoutines.length === 0) && (
        <Card label={t("botPanel.suggestions")} anchor="suggestions" action={<LabelAction data-panel-action="hide-suggestions" onClick={() => setHiddenSuggestions((hidden) => [...hidden, bot.id])}>{t("botPanel.suggestions.hide")}</LabelAction>}>
          {slackUrl && <a href={slackUrl} target="_blank" rel="noopener noreferrer" data-panel-action="manage-slack" className={cn(rowCls, "w-full text-left hover:bg-ink/[0.03]")}>
            <RowIcon icon={Slack} />
            <RowText title={t("botSlack.manage")} />
            <ChevronRight size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          </a>}
          {derived.botRoutines.length === 0 && <NavRow data-panel-action="suggest-routine" icon={Calendar} title={t("botPanel.routines.create")} onClick={() => {
            appendComposerDraft(`bot:${bot.id}:${bot.threadId}`, t("botPanel.routines.suggestionPrompt"));
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
          }} />}
        </Card>
      )}

      <TryAsking bot={bot} />

      <Card label={t("botPanel.tab.computer")} anchor="computer">
        <NavRow data-panel-action="open-computer" icon={Monitor} title={t("computer.screenOf", { name: bot.name })} value={t("place.action.watch")} onClick={() => openComputer()} />
      </Card>

      {conversationItems.length > 0 && (
        <Card label={t("botPanel.section.conversation")} anchor="conversation">
          {conversationItems.map((item) => <ItemRow key={item.key} item={item} />)}
        </Card>
      )}
    </div>
  );
}
