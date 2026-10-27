import { parseDay } from '../planner/dates';
import type { AssistantAction, AssistantContext } from './route';

function validDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(parseDay(value));
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function validRange(start: unknown, end: unknown): { startMinute: number; endMinute: number } | null {
  const startMinute = asInt(start);
  const endMinute = asInt(end);
  if (startMinute === null || endMinute === null) return null;
  if (startMinute < 0 || endMinute > 24 * 60 || endMinute <= startMinute) return null;
  if (endMinute - startMinute > 8 * 60) return null;
  return { startMinute, endMinute };
}

export function scheduleKind(action: unknown): boolean {
  const kind = action && typeof action === 'object' ? (action as { kind?: unknown }).kind : null;
  return kind === 'move-meeting' || kind === 'move-task' || kind === 'reschedule';
}

/** Keep a Gemini calendar change only when it names a task or meeting that is actually loaded. */
export function resolveProposal(action: unknown, context: AssistantContext): AssistantAction {
  if (!action || typeof action !== 'object') return { kind: 'none' };
  const record = action as { kind?: unknown; eventId?: unknown; taskId?: unknown; day?: unknown; startMinute?: unknown; endMinute?: unknown; moves?: unknown };
  if (record.kind === 'move-meeting') {
    const meeting = context.meetings.find((item) => item.id === record.eventId);
    const range = validRange(record.startMinute, record.endMinute);
    if (!meeting || !validDay(record.day) || !range) return { kind: 'none' };
    return {
      kind: 'move-meeting',
      eventId: meeting.id,
      title: meeting.title,
      day: record.day,
      startMinute: range.startMinute,
      endMinute: range.endMinute,
    };
  }
  if (record.kind === 'move-task') {
    const task = context.tasks.find((item) => item.id === record.taskId && item.status !== 'completed');
    if (!task || !validDay(record.day)) return { kind: 'none' };
    return { kind: 'move-task', taskId: task.id, title: task.title, fromLabel: task.dueLabel, day: record.day };
  }
  if (record.kind === 'reschedule' && Array.isArray(record.moves)) {
    const moves = record.moves.flatMap((move) => {
      if (!move || typeof move !== 'object') return [];
      const item = move as { taskId?: unknown; day?: unknown; startMinute?: unknown; endMinute?: unknown };
      const task = context.tasks.find((candidate) => candidate.id === item.taskId && candidate.status !== 'completed');
      const range = validRange(item.startMinute, item.endMinute);
      if (!task || !validDay(item.day) || !range) return [];
      return [{
        taskId: task.id,
        title: task.title,
        day: item.day,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        note: 'Proposed by the assistant.',
      }];
    });
    if (!moves.length) return { kind: 'none' };
    return { kind: 'reschedule', moves };
  }
  return { kind: 'none' };
}
