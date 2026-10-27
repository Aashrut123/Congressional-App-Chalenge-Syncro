import { decodeWallClock, encodeWallClock } from '../format';
import { parseDay, todayDay } from '../planner/dates';

export function dueOnDay(existingIso: string | null, day: string): string | null {
  const date = parseDay(day);
  if (!date) return null;
  const clock = existingIso ? decodeWallClock(existingIso) : new Date(2026, 0, 1, 17, 0);
  date.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return encodeWallClock(date);
}

export function spanOnDay(day: string, startMinute: number, endMinute: number): { starts: string; ends: string } | null {
  const date = parseDay(day);
  if (!date) return null;
  const start = new Date(date);
  start.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
  const end = new Date(date);
  end.setHours(Math.floor(endMinute / 60), endMinute % 60, 0, 0);
  return { starts: encodeWallClock(start), ends: encodeWallClock(end) };
}

export interface AssistantStore {
  taskDue: (id: string) => Promise<string | null>;
  updateTask: (id: string, values: { due_at: string; starts_at?: string; schedule_note?: string; original_due_at?: string }) => Promise<string | null>;
  findLog: (groupId: string, day: string, accomplishments: string) => Promise<boolean>;
  insertLog: (row: { group_id: string; log_date: string; accomplishments: string }) => Promise<string | null>;
  findEvent: (groupId: string, startsAt: string, title: string) => Promise<boolean>;
  insertEvent: (row: { group_id: string; title: string; starts_at: string; ends_at: string; kind: 'meeting' }) => Promise<{ id: string | null; error: string | null }>;
  insertMeeting: (row: { group_id: string; event_id: string; title: string; starts_at: string; ends_at: string }) => Promise<string | null>;
  updateEvent: (id: string, values: { starts_at: string; ends_at: string }) => Promise<string | null>;
  updateMeetingTimes: (eventId: string, values: { starts_at: string; ends_at: string }) => Promise<string | null>;
}

export async function saveMovedTask(store: AssistantStore, taskId: string, day: string): Promise<string> {
  const current = await store.taskDue(taskId);
  const next = dueOnDay(current, day);
  if (!next) return 'That date is not valid.';
  if (current === next) return 'That task is already on this date.';
  const error = await store.updateTask(taskId, { due_at: next });
  return error || 'The due date was saved.';
}

export async function saveReschedule(store: AssistantStore, moves: { taskId: string; day: string; startMinute: number; endMinute: number; note: string }[]): Promise<string> {
  for (const move of moves) {
    const span = spanOnDay(move.day, move.startMinute, move.endMinute);
    if (!span) return 'A proposed time was not valid, so nothing else was moved.';
    const current = await store.taskDue(move.taskId);
    if (current === span.ends) continue;
    const error = await store.updateTask(move.taskId, {
      due_at: span.ends,
      starts_at: span.starts,
      schedule_note: move.note.slice(0, 500),
      original_due_at: current || undefined,
    });
    if (error) return error;
  }
  return 'The confirmed schedule changes were saved.';
}

export async function saveUpdate(store: AssistantStore, groupId: string, accomplishments: string): Promise<string> {
  const text = accomplishments.trim();
  if (text.length < 2) return 'Write what you actually finished before posting.';
  const day = todayDay();
  if (await store.findLog(groupId, day, text)) return 'That update is already posted for today.';
  const error = await store.insertLog({ group_id: groupId, log_date: day, accomplishments: text });
  return error || 'The update was posted.';
}

export async function saveMeeting(store: AssistantStore, input: { groupId: string; title: string; day: string; startMinute: number; endMinute: number }): Promise<string> {
  const span = spanOnDay(input.day, input.startMinute, input.endMinute);
  if (!span) return 'That meeting time is not valid.';
  if (await store.findEvent(input.groupId, span.starts, input.title)) return 'That meeting is already on the calendar.';
  const event = await store.insertEvent({
    group_id: input.groupId,
    title: input.title,
    starts_at: span.starts,
    ends_at: span.ends,
    kind: 'meeting',
  });
  if (event.error || !event.id) return event.error || 'The meeting was not created.';
  const meetingError = await store.insertMeeting({
    group_id: input.groupId,
    event_id: event.id,
    title: input.title,
    starts_at: span.starts,
    ends_at: span.ends,
  });
  if (meetingError) return `The calendar item was saved, but the meeting record failed: ${meetingError}`;
  return 'The meeting was added to the calendar.';
}

export async function saveMovedMeeting(store: AssistantStore, input: { eventId: string; day: string; startMinute: number; endMinute: number }): Promise<string> {
  const span = spanOnDay(input.day, input.startMinute, input.endMinute);
  if (!span) return 'That meeting time is not valid.';
  const eventError = await store.updateEvent(input.eventId, { starts_at: span.starts, ends_at: span.ends });
  if (eventError) return eventError;
  const meetingError = await store.updateMeetingTimes(input.eventId, { starts_at: span.starts, ends_at: span.ends });
  if (meetingError) return `The calendar time was saved, but the meeting record failed: ${meetingError}`;
  return 'The meeting time was saved.';
}
