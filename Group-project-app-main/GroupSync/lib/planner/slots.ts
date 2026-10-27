import { addDays, formatDay, parseDay } from './dates.ts';

export interface ClockPoint {
  day: string;
  minute: number;
}

export interface AvailabilityWindowSlot {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface BusySpan {
  day: string;
  startMinute: number;
  endMinute: number;
}

export interface SlotFound {
  ok: true;
  day: string;
  startMinute: number;
  endMinute: number;
}

export interface SlotMissing {
  ok: false;
  reason: string;
}

export type SlotSearch = SlotFound | SlotMissing;

function inRange(day: string, ranges: { start: string; end: string }[]): boolean {
  return ranges.some((range) => day >= range.start.slice(0, 10) && day <= range.end.slice(0, 10));
}

/** True when the saved block still sits inside one availability window. */
export function slotFits(
  current: { day: string; startMinute: number; endMinute: number } | null,
  windows: AvailabilityWindowSlot[],
  unavailable: { start: string; end: string }[],
  busy: BusySpan[],
  duration: number,
): boolean {
  if (!current || current.endMinute - current.startMinute < duration) return false;
  if (inRange(current.day, unavailable)) return false;
  const date = parseDay(current.day);
  if (!date) return false;
  const inside = windows.some((window) => (
    window.weekday === date.getDay()
    && window.startMinute <= current.startMinute
    && window.endMinute >= current.endMinute
  ));
  return inside && !busy.some((item) => item.day === current.day && item.startMinute < current.endMinute && item.endMinute > current.startMinute);
}

function placeInGap(gap: { start: number; end: number }, duration: number): { start: number; end: number } | null {
  if (gap.end - gap.start < duration) return null;
  let end = gap.start + duration;
  const remainder = end % 30;
  if (remainder !== 0) end += 30 - remainder;
  while (end <= gap.end) {
    const start = end - duration;
    if (start >= gap.start) return { start, end };
    end += 30;
  }
  return { start: gap.start, end: gap.start + duration };
}

function gaps(start: number, end: number, blocks: { startMinute: number; endMinute: number }[]): { start: number; end: number }[] {
  const open: { start: number; end: number }[] = [];
  let cursor = start;
  const sorted = blocks
    .filter((block) => block.endMinute > start && block.startMinute < end)
    .sort((a, b) => a.startMinute - b.startMinute);
  for (const block of sorted) {
    const blockStart = Math.max(block.startMinute, start);
    const blockEnd = Math.min(block.endMinute, end);
    if (blockStart > cursor) open.push({ start: cursor, end: blockStart });
    cursor = Math.max(cursor, blockEnd);
  }
  if (cursor < end) open.push({ start: cursor, end });
  return open;
}

/** Earliest uninterrupted block inside a saved availability window. */
export function findSlot(options: {
  durationMinutes: number;
  earliest: ClockPoint;
  windows: AvailabilityWindowSlot[];
  unavailable: { start: string; end: string }[];
  busy: BusySpan[];
  horizonDays?: number;
}): SlotSearch {
  const duration = Math.round(options.durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: 'This task has no usable duration, so it was not given a time.' };
  }
  if (!options.windows.length) {
    return { ok: false, reason: 'No availability is saved, so this task was not given a time.' };
  }
  const startDay = parseDay(options.earliest.day);
  if (!startDay) return { ok: false, reason: 'The search start date is invalid.' };
  const horizon = Math.min(90, Math.max(1, options.horizonDays ?? 45));
  for (let offset = 0; offset < horizon; offset += 1) {
    const date = addDays(startDay, offset);
    const day = formatDay(date);
    if (inRange(day, options.unavailable)) continue;
    const windows = options.windows
      .filter((window) => window.weekday === date.getDay() && window.endMinute > window.startMinute)
      .sort((a, b) => a.startMinute - b.startMinute);
    const busy = options.busy.filter((item) => item.day === day);
    for (const window of windows) {
      let windowStart = window.startMinute;
      if (day === options.earliest.day) windowStart = Math.max(windowStart, options.earliest.minute);
      if (windowStart >= window.endMinute) continue;
      const open = gaps(windowStart, window.endMinute, busy);
      const fit = open.map((gap) => placeInGap(gap, duration)).find((slot) => slot != null);
      if (!fit) continue;
      return { ok: true, day, startMinute: fit.start, endMinute: fit.end };
    }
  }
  return { ok: false, reason: `No open block is long enough for ${duration} minutes.` };
}

export interface PlacementTask {
  id: string;
  title: string;
  minutes: number;
  priority: 'low' | 'medium' | 'high';
  /** True when the current deadline has passed and the task is unfinished. */
  overdue: boolean;
  /** True when a future slot no longer sits inside availability. */
  slotInvalid: boolean;
  current: { day: string; startMinute: number; endMinute: number } | null;
  dependsOn: string[];
  /** More than one person is assigned. Shared deadlines are not moved. */
  shared: boolean;
  groupDeadline: string | null;
}

export interface PlacementMove {
  id: string;
  from: string | null;
  day: string;
  startMinute: number;
  endMinute: number;
  reason: string;
}

export interface PlacementStuck {
  id: string;
  reason: string;
}

const rank: Record<PlacementTask['priority'], number> = { high: 0, medium: 1, low: 2 };

function label(day: string, minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  const clock = `${hour % 12 || 12}:${String(rest).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  return `${day} ${clock}`;
}

/** Places overdue or invalid tasks into real availability. Does not change project deadlines. */
export function placeTasks(options: {
  now: ClockPoint;
  tasks: PlacementTask[];
  windows: AvailabilityWindowSlot[];
  unavailable: { start: string; end: string }[];
  busy: BusySpan[];
}): { moves: PlacementMove[]; stuck: PlacementStuck[] } {
  const targets = options.tasks.filter((task) => task.overdue || task.slotInvalid);
  const byId = new Map(options.tasks.map((task) => [task.id, task]));
  const moves: PlacementMove[] = [];
  const stuck: PlacementStuck[] = [];
  const placedEnd = new Map<string, ClockPoint>();
  const busy = options.busy.map((item) => ({ ...item }));

  const ordered: PlacementTask[] = [];
  const visiting = new Set<string>();
  const seen = new Set<string>();
  const visit = (task: PlacementTask) => {
    if (seen.has(task.id)) return;
    if (visiting.has(task.id)) return;
    visiting.add(task.id);
    for (const dependencyId of task.dependsOn) {
      const dependency = targets.find((item) => item.id === dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(task.id);
    seen.add(task.id);
    ordered.push(task);
  };
  [...targets].sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title)).forEach(visit);

  for (const task of ordered) {
    if (task.shared) {
      stuck.push({ id: task.id, reason: `${task.title} is shared, so its time was not changed. Pick a slot that works for everyone.` });
      continue;
    }
    let earliest = options.now;
    let waiting = '';
    for (const dependencyId of task.dependsOn) {
      if (stuck.some((item) => item.id === dependencyId)) {
        waiting = `${task.title} waits on unfinished work that has no open time.`;
        break;
      }
      const moved = placedEnd.get(dependencyId);
      const dependency = byId.get(dependencyId);
      if (targets.some((item) => item.id === dependencyId) && !moved) {
        waiting = `${task.title} waits on ${dependency?.title ?? 'an earlier task'}.`;
        break;
      }
      const end = moved ?? (dependency?.current && !dependency.overdue
        ? { day: dependency.current.day, minute: dependency.current.endMinute }
        : null);
      if (end && (end.day > earliest.day || (end.day === earliest.day && end.minute > earliest.minute))) earliest = end;
    }
    if (waiting) {
      stuck.push({ id: task.id, reason: waiting });
      continue;
    }
    const slot = findSlot({
      durationMinutes: task.minutes,
      earliest,
      windows: options.windows,
      unavailable: options.unavailable,
      busy,
    });
    if (!slot.ok) {
      stuck.push({ id: task.id, reason: `${task.title}: ${slot.reason}` });
      continue;
    }
    const same = task.current
      && task.current.day === slot.day
      && task.current.startMinute === slot.startMinute
      && task.current.endMinute === slot.endMinute;
    busy.push({ day: slot.day, startMinute: slot.startMinute, endMinute: slot.endMinute });
    placedEnd.set(task.id, { day: slot.day, minute: slot.endMinute });
    if (same) continue;
    const deadlineNote = task.groupDeadline && slot.day > task.groupDeadline
      ? ` The project deadline ${task.groupDeadline} was not changed.`
      : '';
    moves.push({
      id: task.id,
      from: task.current ? label(task.current.day, task.current.startMinute) : null,
      day: slot.day,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      reason: `Moved to ${label(slot.day, slot.startMinute)} because the previous time no longer fits.${deadlineNote}`,
    });
  }
  return { moves, stuck };
}
