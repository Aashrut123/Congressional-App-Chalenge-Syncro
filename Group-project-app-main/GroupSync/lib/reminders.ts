import type { CalendarEvent, Task } from '../types/database';

const HOUR = 60 * 60 * 1000;
const MEETING_LEAD = 30 * 60 * 1000;
const HORIZON = 21 * 24 * HOUR;
const MAX_ALERTS = 48;

export interface PlannedAlert {
  id: string;
  title: string;
  body: string;
  when: Date;
  href: string;
}

function upcoming(target: Date, leadMs: number, now: Date): Date | null {
  if (Number.isNaN(target.getTime()) || target <= now) return null;
  const early = new Date(target.getTime() - leadMs);
  const when = early > now ? early : target;
  if (when.getTime() - now.getTime() > HORIZON) return null;
  return when;
}

/** Local phone alerts for open tasks and upcoming meetings or deadlines. */
export function planReminders(tasks: Task[], events: CalendarEvent[], now = new Date()): PlannedAlert[] {
  const alerts: PlannedAlert[] = [];

  for (const task of tasks) {
    if (task.status === 'completed' || !task.due_at) continue;
    const when = upcoming(new Date(task.due_at), HOUR, now);
    if (!when) continue;
    alerts.push({
      id: `groupsync-task-${task.id}`,
      title: 'Task due soon',
      body: task.title,
      when,
      href: `/task/${task.id}`,
    });
  }

  for (const event of events) {
    if (event.kind === 'event') continue;
    const when = upcoming(new Date(event.starts_at), event.kind === 'meeting' ? MEETING_LEAD : HOUR, now);
    if (!when) continue;
    alerts.push({
      id: `groupsync-event-${event.id}`,
      title: event.kind === 'meeting' ? 'Meeting coming up' : 'Deadline coming up',
      body: event.title,
      when,
      href: `/event/${event.id}`,
    });
  }

  return alerts.sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, MAX_ALERTS);
}
