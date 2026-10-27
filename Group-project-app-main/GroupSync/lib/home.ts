/** Home screen selection. Pure so the ranking can be tested without the app. */

export const DUE_SOON_MS = 48 * 60 * 60 * 1000;

export type HomeTask = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  createdBy: string;
  assigneeIds: string[];
};

export type NextTaskReason = 'overdue' | 'soon' | 'open';

export type HomeEvent = {
  id: string;
  title: string;
  kind: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type AgendaKind = 'meeting' | 'deadline' | 'event';

export type AgendaItem = {
  key: string;
  id: string;
  kind: AgendaKind;
  title: string;
  at: string;
  href: string;
};

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function isUsersTask(task: HomeTask, userId: string): boolean {
  if (task.assigneeIds.includes(userId)) return true;
  return task.createdBy === userId && task.assigneeIds.length === 0;
}

/** Overdue, then due within 48 hours, then later dated work, then undated. Completed tasks are ignored. */
export function pickNextTask(tasks: HomeTask[], userId: string, now = new Date()): { task: HomeTask; reason: NextTaskReason } | null {
  const nowMs = now.getTime();
  const open = tasks.filter((task) => task.status !== 'completed' && isUsersTask(task, userId));
  const ranked = open
    .map((task) => {
      const due = instant(task.dueAt);
      const bucket = due === null ? 3 : due < nowMs ? 0 : due <= nowMs + DUE_SOON_MS ? 1 : 2;
      return { task, bucket, due: due ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.bucket - b.bucket || a.due - b.due || a.task.title.localeCompare(b.task.title));
  const first = ranked[0];
  if (!first) return null;
  const reason: NextTaskReason = first.bucket === 0 ? 'overdue' : first.bucket === 1 ? 'soon' : 'open';
  return { task: first.task, reason };
}

export function agendaKind(kind: string): AgendaKind {
  if (kind === 'meeting') return 'meeting';
  if (kind === 'deadline') return 'deadline';
  return 'event';
}

export function agendaLabel(kind: AgendaKind): string {
  if (kind === 'meeting') return 'Meeting';
  if (kind === 'deadline') return 'Task due';
  return 'Event';
}

/** Upcoming meetings, events, and open task deadlines, soonest first. Past and undated items are left out. */
export function buildAgenda(
  events: HomeEvent[],
  tasks: HomeTask[],
  now = new Date(),
  limit = 4,
): AgendaItem[] {
  const nowMs = now.getTime();
  const items: AgendaItem[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const start = instant(event.startsAt);
    const end = instant(event.endsAt);
    if (start === null || end === null || end <= nowMs) continue;
    const kind = agendaKind(event.kind);
    const key = `event:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, id: event.id, kind, title: event.title, at: event.startsAt || '', href: `/event/${event.id}` });
  }

  for (const task of tasks) {
    if (task.status === 'completed') continue;
    const due = instant(task.dueAt);
    if (due === null || due <= nowMs || !task.dueAt) continue;
    const key = `task:${task.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, id: task.id, kind: 'deadline', title: task.title, at: task.dueAt, href: `/task/${task.id}` });
  }

  return items.sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title)).slice(0, limit);
}

export function projectTaskProgress(tasks: { status: string }[]): { done: number; total: number; percent: number | null } {
  const total = tasks.length;
  if (!total) return { done: 0, total: 0, percent: null };
  const done = tasks.filter((task) => task.status === 'completed').length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

export function greetingFor(date: Date, timeZone: string): string {
  let hour = 12;
  try {
    const value = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date);
    hour = Number(value);
    if (hour === 24) hour = 0;
  } catch {
    hour = date.getHours();
  }
  if (!Number.isFinite(hour)) hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatWhen(value: string, timeZone: string, withTime: boolean): string {
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dayOnly) {
    const date = new Date(Date.UTC(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]), 12));
    return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(date);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

export function formatClock(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatLongDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  } catch {
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
}
