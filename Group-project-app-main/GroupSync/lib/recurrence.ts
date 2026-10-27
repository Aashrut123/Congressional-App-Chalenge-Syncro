/** Recurrence rules for tasks. Dates are calendar days; the clock comes from the original due time. */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekday'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number | null;
  until: string | null;
  count: number | null;
  anchor: string;
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const REPEAT_PRESETS: { id: RecurrencePreset; label: string }[] = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekday', label: 'Every weekday' },
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Every month' },
  { id: 'yearly', label: 'Every year' },
  { id: 'custom', label: 'Custom' },
];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function calendarStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseStamp(stamp: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), 0, 0);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Shorter months use the last day. Feb 29 on a common year uses Feb 28. */
export function clampMonthDay(year: number, monthIndex: number, day: number): number {
  return Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
}

function weekdayList(weekdays: number[]): number[] {
  return [...new Set(weekdays.filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
}

export function emptyRule(anchor: string): RecurrenceRule {
  return {
    frequency: 'weekly',
    interval: 1,
    weekdays: [],
    monthDay: null,
    until: null,
    count: null,
    anchor,
  };
}

export function ruleFromPreset(preset: RecurrencePreset, due: Date): RecurrenceRule | null {
  if (preset === 'none') return null;
  const anchor = calendarStamp(due);
  const weekday = due.getDay();
  const monthDay = due.getDate();
  if (preset === 'daily') return { frequency: 'daily', interval: 1, weekdays: [], monthDay: null, until: null, count: null, anchor };
  if (preset === 'weekday') return { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], monthDay: null, until: null, count: null, anchor };
  if (preset === 'weekly') return { frequency: 'weekly', interval: 1, weekdays: [weekday], monthDay: null, until: null, count: null, anchor };
  if (preset === 'biweekly') return { frequency: 'weekly', interval: 2, weekdays: [weekday], monthDay: null, until: null, count: null, anchor };
  if (preset === 'monthly') return { frequency: 'monthly', interval: 1, weekdays: [], monthDay, until: null, count: null, anchor };
  if (preset === 'yearly') return { frequency: 'yearly', interval: 1, weekdays: [], monthDay, until: null, count: null, anchor };
  return { ...emptyRule(anchor), weekdays: [weekday], monthDay };
}

export function presetForRule(rule: RecurrenceRule | null): RecurrencePreset {
  if (!rule) return 'none';
  const weekdays = weekdayList(rule.weekdays);
  if (rule.until || rule.count) return 'custom';
  if (rule.frequency === 'daily' && rule.interval === 1) return 'daily';
  if (rule.frequency === 'weekly' && rule.interval === 1 && weekdays.join() === '1,2,3,4,5') return 'weekday';
  if (rule.frequency === 'weekly' && rule.interval === 1 && weekdays.length === 1) return 'weekly';
  if (rule.frequency === 'weekly' && rule.interval === 2 && weekdays.length === 1) return 'biweekly';
  if (rule.frequency === 'monthly' && rule.interval === 1) return 'monthly';
  if (rule.frequency === 'yearly' && rule.interval === 1) return 'yearly';
  return 'custom';
}

export function validateRule(rule: RecurrenceRule): string {
  if (!parseStamp(rule.anchor)) return 'Choose a due date before repeating the task.';
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) {
    return 'Repeat every N must be a whole number from 1 to 365.';
  }
  if (rule.frequency === 'weekly' && !weekdayList(rule.weekdays).length) {
    return 'Choose at least one weekday.';
  }
  if ((rule.frequency === 'monthly' || rule.frequency === 'yearly') && (rule.monthDay == null || rule.monthDay < 1 || rule.monthDay > 31)) {
    return 'Choose a day of the month from 1 to 31.';
  }
  if (rule.count != null && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 999)) {
    return 'Stop after a whole number of times from 1 to 999.';
  }
  if (rule.until) {
    const until = parseStamp(rule.until);
    const anchor = parseStamp(rule.anchor);
    if (!until) return 'Enter a valid end date.';
    if (anchor && until < anchor) return 'The end date cannot be before the first due date.';
  }
  return '';
}

function matches(date: Date, rule: RecurrenceRule): boolean {
  const anchor = parseStamp(rule.anchor);
  if (!anchor) return false;
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day < start) return false;
  const interval = Math.max(1, rule.interval);
  if (rule.frequency === 'daily') {
    const gap = Math.round((day.getTime() - start.getTime()) / 86_400_000);
    return gap % interval === 0;
  }
  if (rule.frequency === 'weekly') {
    const weekdays = weekdayList(rule.weekdays);
    if (!weekdays.includes(day.getDay())) return false;
    const gap = Math.floor(Math.round((day.getTime() - start.getTime()) / 86_400_000) / 7);
    return gap % interval === 0;
  }
  if (rule.frequency === 'monthly') {
    const months = (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
    if (months < 0 || months % interval !== 0) return false;
    return day.getDate() === clampMonthDay(day.getFullYear(), day.getMonth(), rule.monthDay || start.getDate());
  }
  const years = day.getFullYear() - start.getFullYear();
  if (years < 0 || years % interval !== 0) return false;
  if (day.getMonth() !== start.getMonth()) return false;
  return day.getDate() === clampMonthDay(day.getFullYear(), start.getMonth(), rule.monthDay || start.getDate());
}

/** The open due date, then each later repeat through the horizon. */
export function repeatDates(due: Date, rule: RecurrenceRule, occurrenceIndex = 0, horizonDays = 400, max = 120): Date[] {
  if (validateRule(rule)) return [due];
  const through = addDays(due, horizonDays).getTime();
  const dates = [due];
  let cursor = due;
  let index = occurrenceIndex;
  while (dates.length < max) {
    const next = nextOccurrence(cursor, rule, index + 1);
    if (!next || next.getTime() > through) break;
    dates.push(next);
    cursor = next;
    index += 1;
  }
  return dates;
}

export function nextOccurrence(after: Date, rule: RecurrenceRule, nextIndex: number): Date | null {
  if (validateRule(rule)) return null;
  if (rule.count != null && nextIndex >= rule.count) return null;
  const until = rule.until ? parseStamp(rule.until) : null;
  let cursor = addDays(after, 1);
  for (let step = 0; step < 800; step += 1) {
    const stamp = calendarStamp(cursor);
    if (until && stamp > rule.until!) return null;
    if (matches(cursor, rule)) {
      return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), after.getHours(), after.getMinutes(), 0, 0);
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}

export function parseRule(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const frequency = row.frequency;
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') return null;
  const interval = typeof row.interval === 'number' ? row.interval : 1;
  const weekdays = Array.isArray(row.weekdays) ? row.weekdays.filter((day): day is number => typeof day === 'number') : [];
  const monthDay = typeof row.monthDay === 'number' ? row.monthDay : null;
  const until = typeof row.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.until) ? row.until : null;
  const count = typeof row.count === 'number' ? row.count : null;
  const anchor = typeof row.anchor === 'string' ? row.anchor : '';
  const rule: RecurrenceRule = { frequency, interval, weekdays: weekdayList(weekdays), monthDay, until, count, anchor };
  return validateRule(rule) ? null : rule;
}

function weekdayPhrase(weekdays: number[]): string {
  const names = weekdayList(weekdays).map((day) => WEEKDAY_NAMES[day]);
  if (names.length === 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function ruleSummary(rule: RecurrenceRule | null): string {
  if (!rule) return 'Does not repeat';
  const interval = rule.interval;
  const preset = presetForRule(rule);
  let body = '';
  if (preset === 'daily') body = 'Every day';
  else if (preset === 'weekday') body = 'Every weekday (Monday–Friday)';
  else if (preset === 'weekly') body = `Every week on ${weekdayPhrase(rule.weekdays)}`;
  else if (preset === 'biweekly') body = `Every 2 weeks on ${weekdayPhrase(rule.weekdays)}`;
  else if (preset === 'monthly') body = `Every month on day ${rule.monthDay}`;
  else if (preset === 'yearly') body = 'Every year';
  else if (rule.frequency === 'daily') body = interval === 1 ? 'Every day' : `Every ${interval} days`;
  else if (rule.frequency === 'weekly') {
    const days = weekdayPhrase(rule.weekdays);
    body = interval === 1 ? `Every week on ${days}` : `Every ${interval} weeks on ${days}`;
  } else if (rule.frequency === 'monthly') {
    body = interval === 1 ? `Every month on day ${rule.monthDay}` : `Every ${interval} months on day ${rule.monthDay}`;
  } else {
    body = interval === 1 ? 'Every year' : `Every ${interval} years`;
  }
  if (rule.until) body += `, until ${rule.until}`;
  if (rule.count) body += rule.count === 1 ? ', once' : `, ${rule.count} times`;
  return body;
}

export function weekdayLabel(day: number): string {
  return WEEKDAY_SHORT[day] || '';
}

export type ProgressTask = {
  id: string;
  status: string;
  series_id?: string | null;
  skipped?: boolean | null;
};

/** Count the current open occurrence of a series, not every past repeat. */
export function tasksForProgress<T extends ProgressTask>(tasks: T[]): T[] {
  const openSeries = new Map<string, T>();
  const listed: T[] = [];
  for (const task of tasks) {
    if (task.skipped) continue;
    if (!task.series_id) {
      listed.push(task);
      continue;
    }
    if (task.status !== 'completed') openSeries.set(task.series_id, task);
  }
  listed.push(...openSeries.values());
  return listed;
}

export function isVisibleOccurrence<T extends { status: string; skipped?: boolean | null }>(task: T): boolean {
  return !task.skipped && task.status !== 'completed';
}
