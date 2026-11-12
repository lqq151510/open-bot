import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot } from "@/state/store";
import { HELPER_ASK_KEYS } from "./HelperIntro";

// Electron collects -webkit-app-region from layout boxes and ignores z-index, so the chat header's drag strip swallows
// clicks on top of it.
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export const DEFAULT_BOT_CAN_DO_KEYS: readonly LocaleKey[] = [
  "chat.canDo.item.research",
  "chat.canDo.item.writing",
  "chat.canDo.item.coding",
  "chat.canDo.item.computer",
  "chat.canDo.item.tasks",
];

function helperLead(bot: Pick<Bot, "defaultBot" | "chiefOfStaff">, teamName: string | undefined): LocaleKey | null {
  if (!bot.defaultBot) return null;
  if (bot.chiefOfStaff) return "helperIntro.lead.chiefOfStaff";
  if (teamName) return "helperIntro.lead.member";
  return "helperIntro.lead.helper";
}

/** Simple-mode header capsule: this bot's own description, the helper's existing intro, and the engine it actually uses. */
export function WhatICanDo({ bot, engineName, teamName }: {
  bot: Pick<Bot, "description" | "defaultBot" | "chiefOfStaff">;
  engineName: string | null;
  teamName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const description = bot.description.trim();
  const lead = helperLead(bot, teamName);
  const asks = bot.defaultBot ? HELPER_ASK_KEYS : [];
  const capabilities = bot.defaultBot ? DEFAULT_BOT_CAN_DO_KEYS : [];
  const engine = engineName?.trim() ? engineName.trim() : "";
  const empty = !description && !lead && asks.length === 0 && capabilities.length === 0 && !engine;

  return (
    <div ref={containerRef} className="relative" style={noDrag}>
      <button
        type="button"
        data-what-i-can-do=""
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-ink px-3 py-1.5 text-[13px] font-medium text-canvas"
      >
        {t("chat.canDo.label")}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("chat.canDo.label")}
          data-what-i-can-do-panel=""
          style={noDrag}
          className="absolute end-0 top-full z-30 mt-2 w-[min(22rem,70vw)] rounded-2xl border border-hairline/50 bg-card p-3 text-left shadow-lg"
        >
          {description && <p className="text-[13px] leading-relaxed text-ink">{description}</p>}
          {lead && <p className="mt-2 text-[13px] leading-relaxed text-ink first:mt-0">{t(lead)}</p>}
          {capabilities.length > 0 && (
            <div className="mt-2 first:mt-0" data-what-i-can-do-capabilities="">
              <p className="text-[13px] font-medium leading-relaxed text-ink">{t("chat.canDo.defaultIntro")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-4 text-[13px] leading-relaxed text-ink">
                {capabilities.map((key) => <li key={key}>{t(key)}</li>)}
              </ul>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-secondary">{t("chat.canDo.defaultConfirm")}</p>
            </div>
          )}
          {asks.length > 0 && (
            <div className="mt-2 first:mt-0">
              <p className="text-[12px] text-ink-secondary">{t("helperIntro.asks")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-4 text-[13px] leading-relaxed text-ink">
                {asks.map((key) => <li key={key}>{t(key)}</li>)}
              </ul>
            </div>
          )}
          {engine && <p className="mt-2 text-[12px] text-ink-secondary first:mt-0">{t("chat.canDo.engine", { engine })}</p>}
          {empty && <p className="text-[13px] leading-relaxed text-ink-secondary">{t("chat.canDo.empty")}</p>}
        </div>
      )}
    </div>
  );
}
