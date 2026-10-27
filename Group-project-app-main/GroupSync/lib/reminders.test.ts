import assert from 'node:assert/strict';
import test from 'node:test';

import { planReminders } from './reminders';
import type { CalendarEvent, Task } from '../types/database';

const now = new Date('2026-10-19T15:00:00.000Z');

function task(partial: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    group_id: 'g',
    created_by: 'u',
    description: '',
    due_at: null,
    priority: 'medium',
    status: 'todo',
    created_at: '',
    ...partial,
  };
}

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'kind' | 'starts_at'>): CalendarEvent {
  return {
    group_id: 'g',
    created_by: 'u',
    description: '',
    ends_at: partial.starts_at,
    location: '',
    color: null,
    ...partial,
  };
}

test('tasks alert one hour before they are due', () => {
  const alerts = planReminders(
    [task({ id: 'draft', title: 'Draft the report', due_at: '2026-10-19T17:00:00.000Z' })],
    [],
    now,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.title, 'Task due soon');
  assert.equal(alerts[0]?.when.toISOString(), '2026-10-19T16:00:00.000Z');
  assert.equal(alerts[0]?.href, '/task/draft');
});

test('a task due in less than an hour alerts at the due time', () => {
  const alerts = planReminders(
    [task({ id: 'soon', title: 'Send slides', due_at: '2026-10-19T15:30:00.000Z' })],
    [],
    now,
  );
  assert.equal(alerts[0]?.when.toISOString(), '2026-10-19T15:30:00.000Z');
});

test('finished, past, and far-off tasks stay quiet', () => {
  const alerts = planReminders(
    [
      task({ id: 'done', title: 'Done', status: 'completed', due_at: '2026-10-19T18:00:00.000Z' }),
      task({ id: 'late', title: 'Late', due_at: '2026-10-19T14:00:00.000Z' }),
      task({ id: 'later', title: 'Later', due_at: '2026-12-19T15:00:00.000Z' }),
      task({ id: 'open', title: 'No date' }),
    ],
    [],
    now,
  );
  assert.equal(alerts.length, 0);
});

test('meetings alert 30 minutes ahead and deadlines alert one hour ahead', () => {
  const alerts = planReminders(
    [],
    [
      event({ id: 'meet', title: 'Demo practice', kind: 'meeting', starts_at: '2026-10-19T16:30:00.000Z' }),
      event({ id: 'due', title: 'Submit video', kind: 'deadline', starts_at: '2026-10-19T18:00:00.000Z' }),
      event({ id: 'hang', title: 'Study hall', kind: 'event', starts_at: '2026-10-19T18:00:00.000Z' }),
    ],
    now,
  );
  assert.deepEqual(
    alerts.map((alert) => [alert.title, alert.when.toISOString()]),
    [
      ['Meeting coming up', '2026-10-19T16:00:00.000Z'],
      ['Deadline coming up', '2026-10-19T17:00:00.000Z'],
    ],
  );
});

test('only the soonest alerts are kept', () => {
  const tasks = Array.from({ length: 60 }, (_, index) =>
    task({
      id: `t${index}`,
      title: `Task ${index}`,
      due_at: new Date(now.getTime() + (index + 2) * 60 * 60 * 1000).toISOString(),
    }),
  );
  const alerts = planReminders(tasks, [], now);
  assert.equal(alerts.length, 48);
  assert.equal(alerts[0]?.id, 'groupsync-task-t0');
});
