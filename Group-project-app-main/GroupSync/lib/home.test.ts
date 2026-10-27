import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgenda, greetingFor, pickNextTask, projectTaskProgress, type HomeTask } from './home.ts';

const now = new Date('2026-10-23T18:00:00.000Z');

function task(extra: Partial<HomeTask> & Pick<HomeTask, 'id'>): HomeTask {
  return {
    title: extra.id,
    status: 'todo',
    dueAt: null,
    createdBy: 'me',
    assigneeIds: ['me'],
    ...extra,
  };
}

test('the next task is the overdue one, never a finished task', () => {
  const chosen = pickNextTask([
    task({ id: 'done', status: 'completed', dueAt: '2026-10-20T12:00:00.000Z' }),
    task({ id: 'later', dueAt: '2026-11-01T12:00:00.000Z' }),
    task({ id: 'soon', dueAt: '2026-10-24T12:00:00.000Z' }),
    task({ id: 'late', dueAt: '2026-10-22T12:00:00.000Z' }),
  ], 'me', now);
  assert.equal(chosen?.task.id, 'late');
  assert.equal(chosen?.reason, 'overdue');
});

test('a task due soon outranks a later task and an undated one', () => {
  const chosen = pickNextTask([
    task({ id: 'none' }),
    task({ id: 'far', dueAt: '2026-12-01T12:00:00.000Z' }),
    task({ id: 'soon', dueAt: '2026-10-24T16:00:00.000Z' }),
  ], 'me', now);
  assert.equal(chosen?.task.id, 'soon');
  assert.equal(chosen?.reason, 'soon');
});

test('someone else\'s assignment is not the next task', () => {
  const chosen = pickNextTask([
    task({ id: 'theirs', createdBy: 'me', assigneeIds: ['other'], dueAt: '2026-10-22T12:00:00.000Z' }),
    task({ id: 'mine', createdBy: 'other', assigneeIds: ['me'], dueAt: '2026-10-25T12:00:00.000Z' }),
    task({ id: 'personal', createdBy: 'me', assigneeIds: [], dueAt: null }),
  ], 'me', now);
  assert.equal(chosen?.task.id, 'mine');
});

test('agenda keeps future meetings and task deadlines in order', () => {
  const items = buildAgenda(
    [
      { id: 'past', title: 'Old', kind: 'meeting', startsAt: '2026-10-22T12:00:00.000Z', endsAt: '2026-10-22T13:00:00.000Z' },
      { id: 'meet', title: 'Standup', kind: 'meeting', startsAt: '2026-10-24T15:00:00.000Z', endsAt: '2026-10-24T15:30:00.000Z' },
      { id: 'meet', title: 'Standup duplicate', kind: 'meeting', startsAt: '2026-10-24T15:00:00.000Z', endsAt: '2026-10-24T15:30:00.000Z' },
      { id: 'blank', title: 'No time', kind: 'event', startsAt: null, endsAt: null },
    ],
    [
      task({ id: 'due', dueAt: '2026-10-23T20:00:00.000Z' }),
      task({ id: 'old-due', dueAt: '2026-10-22T12:00:00.000Z' }),
      task({ id: 'finished', status: 'completed', dueAt: '2026-10-23T19:00:00.000Z' }),
    ],
    now,
  );
  assert.deepEqual(items.map((item) => item.id), ['due', 'meet']);
  assert.equal(items[0]?.kind, 'deadline');
  assert.equal(items[1]?.kind, 'meeting');
});

test('a project with no tasks does not report zero percent', () => {
  assert.equal(projectTaskProgress([]).percent, null);
  assert.deepEqual(projectTaskProgress([{ status: 'completed' }, { status: 'todo' }]), { done: 1, total: 2, percent: 50 });
});

test('the greeting follows the clock in the chosen timezone', () => {
  assert.equal(greetingFor(new Date('2026-10-23T15:00:00.000Z'), 'America/Chicago'), 'Good morning');
  assert.equal(greetingFor(new Date('2026-10-23T21:00:00.000Z'), 'America/Chicago'), 'Good afternoon');
  assert.equal(greetingFor(new Date('2026-10-24T02:00:00.000Z'), 'America/Chicago'), 'Good evening');
});
