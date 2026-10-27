import assert from 'node:assert/strict';
import test from 'node:test';

import { readAssistantPayload } from './gemini.ts';
import { resolveProposal, scheduleKind } from './proposal.ts';
import type { AssistantContext } from './route.ts';

const context: AssistantContext = {
  userId: 'me',
  now: new Date(2026, 9, 26, 16, 0, 0),
  projects: [{ id: 'p1', name: 'Test 1', deadline: null }],
  tasks: [{
    id: 't1',
    title: 'AP Physics Notes',
    status: 'todo',
    dueAt: '2026-10-24T17:00:00.000Z',
    dueLabel: 'Oct 24',
    groupId: 'p1',
    groupName: 'Test 1',
    blockedReason: '',
    assigneeIds: ['me'],
    createdBy: 'me',
    estimatedMinutes: 60,
    priority: 'medium',
  }],
  meetings: [{ id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-11-02', startMinute: 16 * 60, endMinute: 17 * 60 }],
  windows: [],
  unavailable: [],
  busy: [],
};

test('a fenced Gemini object keeps the reply and the action', () => {
  const parsed = readAssistantPayload('```json\n{"reply":"Move Meet 1 to November 5.","action":{"kind":"move-meeting"}}\n```');
  assert.equal(parsed.reply, 'Move Meet 1 to November 5.');
  assert.equal(scheduleKind(parsed.action), true);
});

test('a plain sentence stays a reply with no calendar change', () => {
  const parsed = readAssistantPayload('Nothing is overdue.');
  assert.equal(parsed.reply, 'Nothing is overdue.');
  assert.equal(parsed.action, null);
});

test('a meeting move is kept only for a loaded meeting', () => {
  const action = resolveProposal({
    kind: 'move-meeting',
    eventId: 'm1',
    day: '2026-11-05',
    startMinute: '960',
    endMinute: 1020,
  }, context);
  assert.equal(action.kind, 'move-meeting');
  if (action.kind === 'move-meeting') {
    assert.equal(action.title, 'Meet 1');
    assert.equal(action.day, '2026-11-05');
    assert.equal(action.startMinute, 960);
  }
  assert.equal(resolveProposal({ kind: 'move-meeting', eventId: 'missing', day: '2026-11-05', startMinute: 960, endMinute: 1020 }, context).kind, 'none');
});

test('task moves and a bad time are dropped', () => {
  const moved = resolveProposal({ kind: 'move-task', taskId: 't1', day: '2026-11-06' }, context);
  assert.equal(moved.kind, 'move-task');
  if (moved.kind === 'move-task') assert.equal(moved.title, 'AP Physics Notes');
  const placed = resolveProposal({
    kind: 'reschedule',
    moves: [
      { taskId: 't1', day: '2026-11-06', startMinute: 16 * 60, endMinute: 17 * 60 },
      { taskId: 'missing', day: '2026-11-06', startMinute: 16 * 60, endMinute: 17 * 60 },
    ],
  }, context);
  assert.equal(placed.kind, 'reschedule');
  if (placed.kind === 'reschedule') assert.equal(placed.moves.length, 1);
  assert.equal(resolveProposal({ kind: 'move-task', taskId: 't1', day: 'November 5' }, context).kind, 'none');
});
