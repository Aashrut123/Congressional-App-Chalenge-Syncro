import { DEFAULT_TIME_ZONE, zonedDateTime } from './timezone';

export function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return 'No due date';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12));
    const rest = { ...(options ?? {}) };
    delete rest.timeZone;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...rest, timeZone: 'UTC' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleDateString(undefined, { timeZone: DEFAULT_TIME_ZONE, month: 'short', day: 'numeric', ...options });
}

export function formatTime(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
}

/** Save the clock the user picked. 9:00 PM stays 9:00 PM instead of shifting by the Central offset. */
export function encodeWallClock(date: Date): string {
  return new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    0,
    0,
  )).toISOString();
}

/** A local date whose clock matches the hours that were saved. */
export function decodeWallClock(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    0,
  );
}

/** The clock on the calendar. Uses the saved hours, not a Central-time conversion. */
export function formatClockFace(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export function wallClockTime(value: string): number {
  return decodeWallClock(value).getTime();
}

/** The saved clock, read as that hour in the profile timezone. 9:00 PM Central stays 9:00 PM Central. */
export function pickedInstant(value: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(NaN);
  return zonedDateTime(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    timeZone,
  );
}

export function dateInputValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function personName(profile: unknown, fallback = 'Teammate'): string {
  const row = Array.isArray(profile) ? profile[0] : profile;
  if (row && typeof row === 'object' && 'display_name' in row) {
    const name = (row as { display_name?: unknown }).display_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return fallback;
}

export function assigneeLabel(assignments: { user_id: string; profile?: unknown }[] | undefined): string {
  if (!assignments?.length) return 'Unassigned';
  const names = assignments.map((row) => personName(row.profile, '')).filter(Boolean);
  if (!names.length) return `${assignments.length} assigned`;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
