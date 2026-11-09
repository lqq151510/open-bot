import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Bot as BotIcon, ChartNoAxesColumn, Keyboard, MessageSquare, Monitor, Puzzle, RefreshCw, Search, Settings, Users, type LucideIcon } from "lucide-react";
import { api, openBot, useStore, visibleMessages, type Bot, type Group } from "@/state/store";
import { rankByName } from "@/lib/palette-rank";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import type { SearchHit } from "@/lib/search-hit";
import { landOnSearchHit } from "@/lib/focus-message";
import { imeComposing } from "@/lib/send-key";
import { BotAvatar } from "./Avatar";
import { lastLine } from "./sidebar-preview";

type PaletteAction = { id: string; label: string; keywords: string; icon: LucideIcon; run: () => void };
type PaletteEntry =
  | { kind: "bot"; bot: Bot }
  | { kind: "room"; group: Group }
  | { kind: "message"; hit: SearchHit }
  | { kind: "action"; action: PaletteAction };

const OPEN_EVENT = "omb:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette({ onOpenChange, onNewBot, onNewGroup }: { onOpenChange?: (open: boolean) => void; onNewBot?: () => void; onNewGroup?: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMessageHits([]);
    setCursor(0);
  }, [open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!open || !q) {
      setMessageHits([]);
      return;
    }
    setMessageHits([]);
    let alive = true;
    const timer = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}&limit=12`)
        .then((result: { hits?: SearchHit[] }) => alive && setMessageHits(result.hits ?? []))
        .catch(() => alive && setMessageHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, messageHits]);

  if (!open) return null;

  const bots = rankByName(state.bots.filter((b) => !b.hidden), q);
  const rooms = rankByName(state.groups, q);
  const actions: PaletteAction[] = [
    ...(onNewBot ? [{ id: "new-bot", label: t("sidebar.newBotSimple"), keywords: "new bot create robot 新建 创建 机器人 新建机器人 新建bot", icon: BotIcon, run: onNewBot }] : []),
    ...(onNewGroup ? [{ id: "new-group", label: t("sidebar.newChat.createGroup"), keywords: "new group create chat 创建群聊 新建群聊 群组", icon: Users, run: onNewGroup }] : []),
    { id: "apps", label: t("sidebar.connectApps"), keywords: "connect apps plugins mcp 连接 应用 插件 连接应用", icon: Puzzle, run: () => dispatch({ type: "togglePlugins", open: true, surface: "apps" }) },
    { id: "settings", label: `${t("settings.title")} · ${t("settings.section.general")}`, keywords: "settings general preferences 设置 通用", icon: Settings, run: () => dispatch({ type: "toggleAppSettings", open: true, section: "general" }) },
    { id: "computer", label: `${t("settings.title")} · ${t("settings.simple.page.computer")}`, keywords: "settings computer desktop 设置 电脑", icon: Monitor, run: () => dispatch({ type: "toggleAppSettings", open: true, section: "computer" }) },
    { id: "usage", label: `${t("settings.title")} · ${t("settings.simple.page.billing")}`, keywords: "settings usage billing quota 设置 用量 账单", icon: ChartNoAxesColumn, run: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }) },
    { id: "updates", label: `${t("settings.title")} · ${t("settings.simple.page.updates")}`, keywords: "settings updates version 设置 更新 版本", icon: RefreshCw, run: () => dispatch({ type: "toggleAppSettings", open: true, section: "updates" }) },
    { id: "shortcuts", label: t("shortcuts.title"), keywords: "keyboard shortcuts help 键盘 快捷键 帮助", icon: Keyboard, run: () => dispatch({ type: "toggleShortcuts", open: true }) },
  ].filter((action) => !q || `${action.label} ${action.keywords}`.toLowerCase().includes(q));
  const entries: PaletteEntry[] = [
    ...bots.map((bot): PaletteEntry => ({ kind: "bot", bot })),
    ...rooms.map((group): PaletteEntry => ({ kind: "room", group })),
    ...(q ? messageHits.map((hit): PaletteEntry => ({ kind: "message", hit })) : []),
    ...actions.map((action): PaletteEntry => ({ kind: "action", action })),
  ];
  const selected = entries.length ? Math.min(cursor, entries.length - 1) : 0;

  const activate = async (entry: PaletteEntry) => {
    if (entry.kind === "message") {
      const hit = entry.hit;
      try {
        await landOnSearchHit(hit, state, dispatch, showThreads);
      } catch (error) {
        dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } else if (entry.kind === "bot") {
      openBot(dispatch, entry.bot, showThreads);
    } else if (entry.kind === "room") {
      dispatch({ type: "select", id: entry.group.id });
    } else {
      setOpen(false);
      entry.action.run();
      return;
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (imeComposing(e.nativeEvent)) { e.stopPropagation(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(entries.length ? (selected + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(entries.length ? (selected - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[selected];
      if (entry) void activate(entry);
    }
  };

  const roomOffset = bots.length;
  const messageOffset = bots.length + rooms.length;
  const actionOffset = messageOffset + (q ? messageHits.length : 0);

  const row = (key: string, index: number, onPick: () => void, children: React.ReactNode, twoLine = false) => (
    <button
      key={key}
      ref={index === selected ? selectedRef : undefined}
      onClick={onPick}
      // mousemove, not mouseenter: rows shifting under a resting pointer must not steal the keyboard selection.
      onMouseMove={() => setCursor(index)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
        twoLine && "flex-col items-stretch gap-0.5",
        index === selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.label")}
        className="popover-surface flex max-h-[min(480px,70vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-hairline/50 bg-card shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-hairline/40 px-4 py-3">
          <Search size={16} className="shrink-0 text-ink-secondary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("commandPalette.searchLabel")}
            placeholder={t("commandPalette.searchPlaceholder")}
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <kbd className="shrink-0 rounded-md border border-hairline/40 px-1.5 py-0.5 text-[11px] text-ink-secondary">
            esc
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">
              {q ? t("sidebar.noMatch", { query }) : t("palette.empty")}
            </div>
          )}
          {bots.length > 0 && (
            <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("palette.bots")}
            </div>
          )}
          {bots.map((bot, i) => {
            const preview = lastLine(bot, visibleMessages(bot), state.instances, showThreads) || bot.title;
            return row(
              `bot:${bot.id}`,
              i,
              () => void activate({ kind: "bot", bot }),
              <>
                <BotAvatar bot={bot} size={30} animated={false} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] text-ink">{bot.name}</span>
                  {preview && (
                    <span className="truncate text-[13px] text-ink-secondary">{preview}</span>
                  )}
                </span>
              </>,
            );
          })}
          {rooms.length > 0 && (
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("palette.groups")}
            </div>
          )}
          {rooms.map((group, i) =>
            row(
              `room:${group.id}`,
              roomOffset + i,
              () => void activate({ kind: "room", group }),
              <>
                <Users size={16} className="shrink-0 text-ink-secondary" />
                <span className="truncate text-[14px] text-ink">{group.name}</span>
              </>,
            ),
          )}
          {q && messageHits.length > 0 && (
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("palette.messages")}
            </div>
          )}
          {q &&
            messageHits.map((hit, i) => {
              const before = hit.snippet.slice(0, hit.matchStart);
              const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
              const after = hit.snippet.slice(hit.matchStart + hit.matchLength);
              return row(
                `msg:${hit.threadId}:${hit.messageId}`,
                messageOffset + i,
                () => void activate({ kind: "message", hit }),
                <>
                  <span className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                    <MessageSquare size={13} className="shrink-0 text-ink-secondary" />
                    {hit.name}
                    {hit.task ? <span className="font-normal text-ink-secondary"> · {hit.task}</span> : null}
                  </span>
                  <span className="line-clamp-2 text-[13px] text-ink-secondary">
                    {before}<mark className="rounded-sm bg-accent/25 px-0.5 text-ink">{match}</mark>{after}
                  </span>
                </>,
                true,
              );
            })}
          {actions.length > 0 && (
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("composer.commands.title")}</div>
          )}
          {actions.map((action, i) => row(`action:${action.id}`, actionOffset + i, () => void activate({ kind: "action", action }), <>
            <action.icon size={16} className="shrink-0 text-ink-secondary" />
            <span className="truncate text-[14px] text-ink">{action.label}</span>
          </>))}
        </div>
      </div>
    </div>
  );
}
