/** Calendar dates as local YYYY-MM-DD values, independent of time zones. */

export function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function daySpan(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86_400_000);
}

export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  if (end < start) return days;
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

export function todayDay(now = new Date()): string {
  return formatDay(now);
}

/** Inclusive calendar-day match for YYYY-MM-DD values. An invalid end uses the start day. */
export function stampInRange(start: string, end: string, stamp: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return false;
  const last = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : start;
  const from = start <= last ? start : last;
  const to = start <= last ? last : start;
  return from <= stamp && stamp <= to;
}

/** A meeting or deadline is still upcoming until its end time has passed. */
export function isStillScheduled(endsAt: string, now = new Date()): boolean {
  const end = new Date(endsAt);
  return !Number.isNaN(end.getTime()) && end > now;
}

/** True when the event covers any part of the local calendar day. */
export function overlapsLocalDay(startsAt: string, endsAt: string, day: Date): boolean {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return start < dayEnd && end > dayStart;
}

/** Local clock time on a calendar day. The returned Date keeps that hour in the device time zone. */
export function atLocalTime(day: string, hour: number, minute = 0): Date | null {
  const date = parseDay(day);
  if (!date) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  date.setHours(hour, minute, 0, 0);
  return date;
}
