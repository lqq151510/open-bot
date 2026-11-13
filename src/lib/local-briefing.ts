import type { BriefingInterval, LocalCalendarPreview } from "../../shared/local-briefing";
import { intlLocale, t } from "./i18n";

const HALF_HOUR = 30 * 60_000;

export function calendarFreeTimes(preview: LocalCalendarPreview): BriefingInterval[] | null {
  if (preview.truncated) return null;
  const busy = preview.events.filter(event => event.busy).map(event => event.time).sort((a, b) => a.start - b.start);
  const free: BriefingInterval[] = [];
  for (const hours of preview.workingHours) {
    let cursor = hours.start;
    for (const event of busy) {
      if (event.end <= cursor) continue;
      if (event.start >= hours.end) break;
      if (event.start - cursor >= HALF_HOUR) free.push({ start: cursor, end: event.start });
      cursor = Math.max(cursor, event.end);
    }
    if (hours.end - cursor >= HALF_HOUR) free.push({ start: cursor, end: hours.end });
  }
  return free;
}

export function calendarBriefing(preview: LocalCalendarPreview) {
  const timeZone = preview.timeZone;
  const locale = intlLocale();
  const date = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" });
  const dateTime = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const timedRange = ({ start, end }: BriefingInterval) => date.format(start) === date.format(end)
    ? t("localBrief.range", { date: date.format(start), time: start === end ? time.format(start) : time.formatRange(start, end) })
    : dateTime.formatRange(start, end);
  const allDayRange = ({ start, end }: BriefingInterval) => {
    const last = Math.max(start, end - 1);
    const days = date.format(start) === date.format(last) ? date.format(start) : date.formatRange(start, last);
    return t("localBrief.allDayOn", { date: days });
  };
  const rows = preview.events.map(event => ({
    title: event.title.replace(/\s+/gu, " ").trim() || t("localBrief.untitled"),
    time: event.allDay ? allDayRange(event.time) : timedRange(event.time),
    calendar: event.calendar.replace(/\s+/gu, " ").trim(),
  }));
  const free = calendarFreeTimes(preview)?.map(timedRange) ?? null;
  const period = preview.period;
  const last = period.end - 1;
  const dates = date.format(period.start) === date.format(last) ? date.format(period.start) : date.formatRange(period.start, last);
  return { dates, rows, free, timeZone };
}

export function localBriefingText(calendar: ReturnType<typeof calendarBriefing> | null, weather: string | null): string {
  const lines: string[] = [];
  if (calendar) {
    lines.push(t("localBrief.scheduleFor", { dates: calendar.dates, zone: calendar.timeZone }));
    lines.push(...(calendar.rows.length ? calendar.rows.map(event => `- ${event.time} · ${event.title} (${event.calendar})`) : [t("localBrief.noEvents")]));
    if (calendar.free?.length) lines.push("", t("localBrief.freeTimes"), ...calendar.free.map(time => `- ${time}`));
    else lines.push("", t(calendar.free === null ? "localBrief.truncated" : "localBrief.noFreeTimes"));
  }
  if (weather) lines.push(...(lines.length ? [""] : []), t("localBrief.weather"), weather);
  return lines.join("\n").replaceAll("<", "&lt;");
}
