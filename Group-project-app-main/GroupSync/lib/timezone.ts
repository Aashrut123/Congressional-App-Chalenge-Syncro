/** Profile timezones used for calendar days and away-date conflicts. */

export const TIME_ZONES: { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'UTC', label: 'UTC' },
];

export function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Syncro uses Central time unless a profile has chosen another zone. */
export const DEFAULT_TIME_ZONE = 'America/Chicago';

export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isTimeZone(zone)) return zone;
  } catch {
    // Intl can throw if the runtime has no timezone data.
  }
  return DEFAULT_TIME_ZONE;
}

export function preferredTimeZone(saved?: string | null): string {
  // UTC is the old database default, not a choice the person made.
  if (saved && saved !== 'UTC' && isTimeZone(saved)) return saved;
  return DEFAULT_TIME_ZONE;
}

export function timezoneChoices(selected?: string | null): { id: string; label: string }[] {
  const choices = [...TIME_ZONES];
  const extra = [deviceTimeZone(), selected || ''].filter(Boolean);
  for (const id of extra) {
    if (!choices.some((item) => item.id === id) && isTimeZone(id)) {
      choices.unshift({ id, label: id.replace(/_/g, ' ') });
    }
  }
  return choices;
}

export function timezoneLabel(value: string): string {
  return timezoneChoices(value).find((item) => item.id === value)?.label || value.replace(/_/g, ' ');
}

function zoneParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Milliseconds to add to a UTC instant so its clock matches the timezone. */
function zoneOffset(date: Date, timeZone: string): number {
  const parts = zoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Calendar day in a timezone, as YYYY-MM-DD. Saturday night Central stays Saturday. */
export function zonedDayStamp(date: Date, timeZone: string): string {
  const parts = zoneParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Weekday of a YYYY-MM-DD value. Sunday is 0. */
export function weekdayIndex(stamp: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
  if (!match) return 0;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** A wall-clock time in a timezone, as an absolute instant. */
export function zonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(guess.getTime() - zoneOffset(guess, timeZone));
  return new Date(guess.getTime() - zoneOffset(first, timeZone));
}

function calendarParts(day: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Inclusive first day through inclusive last day, as instants in the profile timezone. */
export function unavailableBounds(startsOn: string, endsOn: string, timeZone: string): { start: string; end: string } {
  const start = calendarParts(startsOn);
  const end = calendarParts(endsOn);
  if (!start || !end || !isTimeZone(timeZone)) {
    return { start: startsOn, end: endsOn };
  }
  const startInstant = zonedDateTime(start.year, start.month, start.day, 0, 0, timeZone);
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day));
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endInstant = zonedDateTime(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate(), 0, 0, timeZone);
  return { start: startInstant.toISOString(), end: endInstant.toISOString() };
}

/** True when the event covers any part of that calendar day in the given timezone. */
export function overlapsZonedDay(startsAt: string, endsAt: string, day: Date, timeZone: string): boolean {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !isTimeZone(timeZone)) return false;
  const dayStart = zonedDateTime(day.getFullYear(), day.getMonth() + 1, day.getDate(), 0, 0, timeZone);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const dayEnd = zonedDateTime(next.getFullYear(), next.getMonth() + 1, next.getDate(), 0, 0, timeZone);
  return start < dayEnd && end > dayStart;
}
