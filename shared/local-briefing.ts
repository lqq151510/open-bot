export type BriefingDays = 1 | 7;

export interface BriefingInterval {
  start: number;
  end: number;
}

export interface LocalCalendarOption {
  id: string;
  title: string;
  account: string;
}

export interface LocalCalendarEvent {
  title: string;
  calendar: string;
  time: BriefingInterval;
  allDay: boolean;
  busy: boolean;
}

export interface LocalCalendarPreview {
  timeZone: string;
  period: BriefingInterval;
  workingHours: BriefingInterval[];
  events: LocalCalendarEvent[];
  truncated: boolean;
}

type CalendarFailure = "notDetermined" | "writeOnly" | "restricted" | "denied" | "unavailable" | "unsupported" |
  "busy" | "invalidSelection" | "selectionChanged";

export type LocalCalendarResult<T = unknown> = ({ status: "granted" } & T) | { status: CalendarFailure };

/** Local desktop IPC. A calendar query contains only the explicitly chosen calendars and date range. */
export interface LocalCalendarBridge {
  list(): Promise<LocalCalendarResult<{ calendars: LocalCalendarOption[] }>>;
  status(): Promise<LocalCalendarResult>;
  request(): Promise<LocalCalendarResult<{ calendars: LocalCalendarOption[] }>>;
  preview(ids: string[], days: BriefingDays): Promise<LocalCalendarResult<{ preview: LocalCalendarPreview }>>;
  weather(): Promise<{ status: "ready"; text: string } | { status: "unavailable" | "busy" }>;
  openShortcuts(): Promise<void | false>;
}
