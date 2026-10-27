import { decodeWallClock, encodeWallClock, pickedInstant } from '@/lib/format';
import { formatDay } from '@/lib/planner/dates';
import { placeTasks, slotFits, type BusySpan, type PlacementTask } from '@/lib/planner/slots';
import { preferredTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { AvailabilityWindow, CalendarEvent, Task, UnavailablePeriod } from '@/types/database';

function wallDate(day: string, minute: number): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year || 2026, (month || 1) - 1, date || 1, Math.floor(minute / 60), minute % 60, 0, 0);
}

function nowClock(timeZone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    minute: Number(read('hour')) * 60 + Number(read('minute')),
  };
}

function spanOf(startIso?: string | null, endIso?: string | null): BusySpan | null {
  if (!startIso || !endIso) return null;
  const start = decodeWallClock(startIso);
  const end = decodeWallClock(endIso);
  if (formatDay(start) !== formatDay(end)) return null;
  const startMinute = start.getHours() * 60 + start.getMinutes();
  const endMinute = end.getHours() * 60 + end.getMinutes();
  if (endMinute <= startMinute) return null;
  return { day: formatDay(start), startMinute, endMinute };
}

let lastKey = '';
let running = false;
let columnsMissing = false;

export async function applyOverdueReschedule(input: {
  userId: string;
  timeZone?: string | null;
  tasks: Task[];
  events: CalendarEvent[];
  windows: AvailabilityWindow[];
  unavailable: UnavailablePeriod[];
}): Promise<void> {
  if (columnsMissing || running) return;
  const timeZone = preferredTimeZone(input.timeZone);
  const key = JSON.stringify({
    userId: input.userId,
    windows: input.windows.map((window) => [window.weekday, window.start_minute, window.end_minute]),
    away: input.unavailable.map((period) => [period.starts_on, period.ends_on]),
    tasks: input.tasks.map((task) => [task.id, task.status, task.due_at, task.starts_at, task.schedule_note, task.estimated_minutes, (task.assignments ?? []).map((item) => item.user_id).join(',')]),
    events: input.events.map((event) => [event.id, event.starts_at, event.ends_at]),
  });
  if (key === lastKey) return;
  running = true;
  try {
    const now = nowClock(timeZone);
    const windows = input.windows.map((window) => ({
      weekday: window.weekday,
      startMinute: window.start_minute,
      endMinute: window.end_minute,
    }));
    const unavailable = input.unavailable.map((period) => ({ start: period.starts_on, end: period.ends_on }));
    const meetingBusy = input.events.flatMap((event) => {
      const span = spanOf(event.starts_at, event.ends_at);
      return span ? [span] : [];
    });
    const mine = input.tasks.filter((task) => {
      if (task.status === 'completed' || task.skipped) return false;
      const owners = task.assignments?.map((item) => item.user_id) ?? [];
      if (owners.length === 0 || owners.length > 1) return true;
      return owners[0] === input.userId;
    });
    for (const task of mine) {
      const owners = task.assignments?.map((item) => item.user_id) ?? [];
      if (owners.length > 0) continue;
      const { error } = await supabase.from('task_assignments').insert({
        task_id: task.id,
        user_id: input.userId,
      });
      if (error && !/duplicate key|unique constraint|already exists/i.test(error.message)) continue;
      task.assignments = [{ user_id: input.userId }];
    }
    const dependencyRows = await supabase.from('task_dependencies').select('task_id, depends_on');
    const depends = new Map<string, string[]>();
    for (const row of (dependencyRows.error ? [] : dependencyRows.data ?? []) as { task_id: string; depends_on: string }[]) {
      const list = depends.get(row.task_id) ?? [];
      list.push(row.depends_on);
      depends.set(row.task_id, list);
    }
    const openIds = new Set(input.tasks.filter((task) => task.status !== 'completed' && !task.skipped).map((task) => task.id));
    const placement: PlacementTask[] = mine.flatMap((task) => {
      const current = spanOf(task.starts_at, task.due_at);
      const minutes = task.estimated_minutes && task.estimated_minutes > 0 ? task.estimated_minutes : 60;
      const owners = task.assignments?.map((item) => item.user_id) ?? [];
      const overdue = Boolean(task.due_at) && pickedInstant(task.due_at as string, timeZone).getTime() < Date.now();
      const aligned = !current || current.endMinute % 30 === 0;
      const slotInvalid = Boolean(current) && (!aligned || !slotFits(current, windows, unavailable, meetingBusy, minutes));
      if (!overdue && !slotInvalid && owners.length <= 1) return [];
      return [{
        id: task.id,
        title: task.title,
        minutes,
        priority: task.priority,
        overdue,
        slotInvalid,
        current,
        dependsOn: (depends.get(task.id) ?? []).filter((id) => openIds.has(id)),
        shared: owners.length > 1,
        groupDeadline: task.group?.deadline ?? null,
      }];
    });
    const moving = new Set(placement.map((task) => task.id));
    const taskBusy = mine.flatMap((task) => {
      if (moving.has(task.id)) return [];
      const span = spanOf(task.starts_at, task.due_at);
      return span ? [span] : [];
    });
    const plan = placeTasks({
      now,
      tasks: placement,
      windows,
      unavailable,
      busy: [...meetingBusy, ...taskBusy],
    });
    for (const move of plan.moves) {
      const task = input.tasks.find((item) => item.id === move.id);
      if (!task) continue;
      const starts = encodeWallClock(wallDate(move.day, move.startMinute));
      const ends = encodeWallClock(wallDate(move.day, move.endMinute));
      if (task.starts_at === starts && task.due_at === ends) continue;
      const { error } = await supabase.from('tasks').update({
        starts_at: starts,
        due_at: ends,
        original_due_at: task.original_due_at ?? task.due_at,
        schedule_note: move.reason.slice(0, 500),
      }).eq('id', task.id);
      if (error) {
        if (/schedule_note|original_due_at|schema cache|column/i.test(error.message)) columnsMissing = true;
        return;
      }
    }
    for (const item of plan.stuck) {
      const task = input.tasks.find((row) => row.id === item.id);
      if (!task || task.schedule_note === item.reason) continue;
      const { error } = await supabase.from('tasks').update({
        schedule_note: item.reason.slice(0, 500),
      }).eq('id', item.id);
      if (error) {
        if (/schedule_note|schema cache|column/i.test(error.message)) columnsMissing = true;
        return;
      }
    }
    lastKey = key;
  } finally {
    running = false;
  }
}
