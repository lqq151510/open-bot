import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CloudSun, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { calendarBriefing, localBriefingText } from "@/lib/local-briefing";
import type { BriefingDays, LocalCalendarBridge, LocalCalendarOption, LocalCalendarPreview, LocalCalendarResult } from "../../shared/local-briefing";

const quietButton = "rounded-full border border-hairline px-3 py-1.5 text-[13px] font-medium hover:bg-raised disabled:opacity-45";
const primaryButton = "rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-app hover:opacity-90 disabled:opacity-45";
const heading = "flex items-center gap-2 text-[14px] font-semibold text-ink";
const secondary = "text-[13px] leading-5 text-ink-secondary";

type CalendarStatus = LocalCalendarResult["status"];

export function LocalBriefingDialog({ bridge, model, returnFocus, onClose, onAdd }: {
  bridge: LocalCalendarBridge;
  model?: string;
  returnFocus?: HTMLElement | null;
  onClose(): void;
  onAdd?: (text: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<CalendarStatus | "loading">("loading");
  const [calendars, setCalendars] = useState<LocalCalendarOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState<BriefingDays>(1);
  const [calendar, setCalendar] = useState<LocalCalendarPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [weather, setWeather] = useState<string | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [weatherSetup, setWeatherSetup] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);

  const applyCalendars = (result: Awaited<ReturnType<LocalCalendarBridge["list"]>>) => {
    setStatus(result.status);
    if (result.status !== "granted") return;
    setCalendars(result.calendars);
    setSelected(ids => ids.filter(id => result.calendars.some(item => item.id === id)));
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog?.showModal();
    let active = true;
    void bridge.list().then(result => { if (active) applyCalendars(result); }, () => { if (active) setStatus("unavailable"); });
    return () => {
      active = false;
      dialog?.close();
      requestAnimationFrame(() => { if (opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus(); });
    };
  }, [bridge, returnFocus]);

  const loadCalendars = async (request: boolean) => {
    setLoading(true);
    setCalendar(null);
    setSettingsFailed(false);
    try {
      applyCalendars(await (request ? bridge.request() : bridge.list()));
    } catch {
      setStatus("unavailable");
    } finally {
      setLoading(false);
    }
  };

  const preview = async () => {
    setLoading(true);
    setCalendar(null);
    try {
      const result = await bridge.preview(selected, days);
      if (result.status === "granted") setCalendar(result.preview);
      else setStatus(result.status);
    } catch {
      setStatus("unavailable");
    } finally {
      setLoading(false);
    }
  };

  const fetchWeather = async () => {
    setWeatherStatus("loading");
    setWeather(null);
    try {
      const result = await bridge.weather();
      if (result.status === "ready") {
        setWeather(result.text);
        setWeatherStatus("idle");
        setWeatherSetup(false);
        return;
      }
    } catch {}
    setWeatherStatus("failed");
    setWeatherSetup(true);
  };

  const briefing = calendar ? calendarBriefing(calendar) : null;
  const addToDraft = async () => {
    if (!onAdd || (!briefing && !weather)) return;
    if (!calendar) { onAdd(localBriefingText(null, weather)); return; }
    setLoading(true);
    try {
      const result = await bridge.status();
      if (!dialogRef.current?.open) return;
      if (result.status !== "granted") {
        setCalendar(null);
        setStatus(result.status);
        return;
      }
      onAdd(localBriefingText(briefing, weather));
    } catch {
      setCalendar(null);
      setStatus("unavailable");
    } finally {
      setLoading(false);
    }
  };
  const request = status === "notDetermined" || status === "writeOnly";
  const settings = status === "denied" || status === "restricted";
  const calendarMessage = status === "loading" || loading ? "localBrief.loading"
    : status === "unsupported" ? "localBrief.requiresMac14"
    : settings ? "localBrief.permissionDenied"
    : request ? "localBrief.permission"
    : status === "selectionChanged" ? "localBrief.selectionChanged"
    : status !== "granted" ? "localBrief.calendarUnavailable"
    : calendars.length === 0 ? "localBrief.noCalendars" : null;

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={onClose}
      onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
      className="m-auto flex max-h-[90dvh] w-[min(92vw,560px)] max-w-none flex-col overflow-hidden rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/50">
      <header className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h2 id={titleId} className="text-[16px] font-semibold">{t("localBrief.title")}</h2>
        <button type="button" autoFocus onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-raised" aria-label={t("common.close")}><X size={17} /></button>
      </header>
      <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
        <section className="space-y-2.5">
          <h3 className={heading}><CalendarDays size={16} />{t("localBrief.calendar")}</h3>
          {calendarMessage && <p className={secondary} role="status">{t(calendarMessage)}</p>}
          {status === "granted" && calendars.length > 0 ? <>
            <fieldset disabled={loading} className="max-h-36 space-y-1.5 overflow-y-auto rounded-xl bg-inset p-3">
              <legend className="sr-only">{t("localBrief.chooseCalendars")}</legend>
              {calendars.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={selected.includes(item.id)} onChange={event => {
                  const checked = event.currentTarget.checked;
                  setSelected(ids => checked ? [...ids, item.id] : ids.filter(id => id !== item.id));
                  setCalendar(null);
                }} className="size-4 shrink-0 accent-current" />
                <span dir="auto" className="min-w-0 truncate">{item.title}{item.account && <span className="text-ink-tertiary"> · {item.account}</span>}</span>
              </label>)}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={t("localBrief.rangeLabel")} value={days} disabled={loading} onChange={event => {
                setDays(event.currentTarget.value === "7" ? 7 : 1);
                setCalendar(null);
              }} className="rounded-lg border border-hairline bg-card px-2 py-1.5 text-[13px]">
                <option value={1}>{t("chat.day.today")}</option>
                <option value={7}>{t("localBrief.week")}</option>
              </select>
              <button type="button" disabled={loading || !selected.length} onClick={() => void preview()} className={quietButton}>{t("localBrief.preview")}</button>
            </div>
          </> : status !== "loading" && status !== "unsupported" && <div className="flex flex-wrap gap-2">
            {settings && <button type="button" className={quietButton} onClick={() => {
              void window.ogb?.permOpenSettings("calendars").catch(() => setSettingsFailed(true));
            }}>{t("connectors.openSettings")}</button>}
            <button type="button" disabled={loading} onClick={() => void loadCalendars(request)} className={quietButton}>
              {t(request ? "localBrief.allowCalendar" : "localBrief.refreshCalendars")}
            </button>
          </div>}
          {settingsFailed && <p role="status" className={secondary}>{t("localBrief.openSettingsFailed")}</p>}
          {briefing && <div className="space-y-2 rounded-xl bg-inset p-3 text-[13px]">
            <p className="font-medium">{briefing.dates} <span className="font-normal text-ink-secondary">· {briefing.timeZone}</span></p>
            {briefing.rows.length ? <ul className="space-y-1">
              {briefing.rows.map((row, index) => <li key={index} dir="auto" className="break-words">
                <span className="text-ink-secondary">{row.time} · </span>{row.title} <span className="text-ink-tertiary">({row.calendar})</span>
              </li>)}
            </ul> : <p className={secondary}>{t("localBrief.noEvents")}</p>}
            {briefing.free?.length ? <div>
              <p className="font-medium">{t("localBrief.freeTimes")}</p>
              <ul className="mt-0.5 text-ink-secondary">{briefing.free.map(time => <li key={time}>{time}</li>)}</ul>
            </div> : <p className={secondary}>{t(briefing.free === null ? "localBrief.truncated" : "localBrief.noFreeTimes")}</p>}
          </div>}
        </section>
        <section className="space-y-2.5 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={heading}><CloudSun size={16} />{t("localBrief.weather")}</h3>
            <button type="button" disabled={weatherStatus === "loading"} onClick={() => void fetchWeather()} className={quietButton}>{t("localBrief.getWeather")}</button>
          </div>
          {weather && <p dir="auto" className="whitespace-pre-wrap break-words rounded-xl bg-inset p-3 text-[13px]">{weather}</p>}
          {weatherStatus === "loading" && <p role="status" className={secondary}>{t("localBrief.loadingWeather")}</p>}
          {weatherStatus === "failed" && <p role="status" className={secondary}>{t("localBrief.weatherUnavailable")}</p>}
          <button type="button" aria-expanded={weatherSetup} onClick={() => setWeatherSetup(open => !open)} className="text-[13px] font-medium text-accent-text hover:underline">{t("localBrief.weatherSetup")}</button>
          {weatherSetup && <div className="space-y-2"><p className={secondary}>{t("localBrief.weatherInstructions")}</p>
            <button type="button" className={quietButton} onClick={() => void bridge.openShortcuts().catch(() => setWeatherStatus("failed"))}>{t("localBrief.openShortcuts")}</button>
          </div>}
        </section>
      </div>
      {onAdd && <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-3">
        <p className="min-w-36 flex-1 text-[12px] text-ink-secondary">{t(model ? "localBrief.shareWithModel" : "localBrief.share", model ? { model } : undefined)}</p>
        <button type="button" className={primaryButton} disabled={loading || weatherStatus === "loading" || (!briefing && !weather)}
          onClick={() => void addToDraft()}>{t("localBrief.addToDraft")}</button>
      </footer>}
    </dialog>, document.body,
  );
}

export function matchesLocalBriefingSearch(search: string): boolean {
  return [t("localBrief.title"), t("localBrief.calendar"), t("localBrief.weather")]
    .join(" ").toLowerCase().includes(search.trim().toLowerCase());
}

export function LocalBriefingCard({ bridge }: { bridge: LocalCalendarBridge }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-hairline/40 bg-card p-4">
      <CalendarDays className="size-5 shrink-0 text-ink-secondary" aria-hidden="true" />
      <div className="min-w-28 flex-1">
        <h3 className="text-[14px] font-semibold text-ink">{t("localBrief.title")}</h3>
        <p className="text-[13px] text-ink-secondary">{t("localBrief.calendarAndWeather")}</p>
      </div>
      <button ref={button} type="button" onClick={() => setOpen(true)} className={quietButton}>{t("localBrief.openBrief")}</button>
      {open && <LocalBriefingDialog bridge={bridge} returnFocus={button.current} onClose={() => setOpen(false)} />}
    </section>
  );
}
