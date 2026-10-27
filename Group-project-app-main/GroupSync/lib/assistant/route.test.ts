import assert from 'node:assert/strict';
import test from 'node:test';

import { saveMeeting, saveMovedMeeting, saveMovedTask, saveUpdate } from './execute.ts';
import { interpret, needsModel, nextNamedDay, type AssistantContext, type AssistantTask } from './route.ts';

const now = new Date(2026, 9, 25, 18, 0, 0);

function task(partial: Partial<AssistantTask> & Pick<AssistantTask, 'id' | 'title'>): AssistantTask {
  return {
    status: 'todo',
    dueAt: '2026-10-24T17:00:00.000Z',
    dueLabel: 'Oct 24',
    groupId: 'p1',
    groupName: 'Math Olympiad',
    blockedReason: '',
    assigneeIds: ['me'],
    createdBy: 'me',
    estimatedMinutes: 60,
    priority: 'medium',
    ...partial,
  };
}

function context(extra: Partial<AssistantContext> = {}): AssistantContext {
  return {
    userId: 'me',
    now,
    projects: [{ id: 'p1', name: 'Math Olympiad', deadline: '2026-11-08' }],
    tasks: [task({ id: 't1', title: 'Algebra review' })],
    windows: [{ weekday: 0, startMinute: 16 * 60, endMinute: 21 * 60 }],
    unavailable: [],
    busy: [],
    meetings: [],
    ...extra,
  };
}

test('a named plan opens the existing planner', () => {
  const turn = interpret('Create a plan for my science fair project.', context({ projects: [] }));
  assert.equal(turn.action.kind, 'open-plan');
  if (turn.action.kind === 'open-plan') {
    assert.equal(turn.action.mode, 'new');
    assert.equal(turn.action.name, 'Science fair project');
  }
});

test('today asks for the real next task', () => {
  const turn = interpret('What should I work on today?', context());
  assert.match(turn.reply, /Algebra review/);
  assert.equal(turn.action.kind, 'none');
});

test('friday is the upcoming Friday and the task is not saved yet', () => {
  assert.equal(nextNamedDay(now, 5), '2026-10-30');
  const turn = interpret('Move my task to Friday.', context());
  assert.equal(turn.action.kind, 'move-task');
  if (turn.action.kind === 'move-task') assert.equal(turn.action.day, '2026-10-30');
  assert.match(turn.reply, /Confirm/);
});

test('an existing meeting moves to the named day and waits for confirmation', () => {
  const turn = interpret('Reschedule the team meeting to Friday.', context({
    meetings: [{ id: 'm1', title: 'Team meeting', groupId: 'p1', groupName: 'Math Olympiad', day: '2026-10-26', startMinute: 17 * 60, endMinute: 18 * 60 }],
  }));
  assert.equal(turn.action.kind, 'move-meeting');
  if (turn.action.kind === 'move-meeting') {
    assert.equal(turn.action.eventId, 'm1');
    assert.equal(turn.action.day, '2026-10-30');
    assert.equal(turn.action.startMinute, 17 * 60);
    assert.equal(turn.action.endMinute, 18 * 60);
  }
  assert.match(turn.reply, /Confirm/);
});

test('a misspelled reschedule for next week moves the meeting on that date', () => {
  const meetings = [
    { id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-10-30', startMinute: 17 * 60, endMinute: 18 * 60 },
    { id: 'm2', title: 'Payload Design 1', groupId: 'p1', groupName: 'Test 1', day: '2026-11-02', startMinute: 16 * 60, endMinute: 17 * 60 },
  ];
  const turn = interpret('Cant make the meeting on the 30th, resceduele for next week', context({
    projects: [{ id: 'p1', name: 'Test 1', deadline: '2026-11-08' }],
    meetings,
  }));
  assert.equal(turn.action.kind, 'move-meeting');
  if (turn.action.kind === 'move-meeting') {
    assert.equal(turn.action.eventId, 'm1');
    assert.equal(turn.action.day, '2026-11-06');
  }
  assert.match(turn.reply, /Confirm/);
});

test('naming the meeting continues the move instead of resetting', () => {
  const meetings = [
    { id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-10-30', startMinute: 17 * 60, endMinute: 18 * 60 },
    { id: 'm2', title: 'Payload Design 1', groupId: 'p1', groupName: 'Test 1', day: '2026-11-02', startMinute: 16 * 60, endMinute: 17 * 60 },
  ];
  const base = context({ projects: [{ id: 'p1', name: 'Test 1', deadline: null }], meetings });
  const asked = interpret('Move a meeting', base);
  assert.match(asked.reply, /Which meeting should move/);
  assert.equal(asked.followUp?.kind, 'move-meeting');
  const named = interpret('meet 1', base, asked.followUp);
  assert.match(named.reply, /Which day should “Meet 1”/);
  assert.equal(named.followUp?.kind, 'meeting-day');
  const moved = interpret('next week', base, named.followUp);
  assert.equal(moved.action.kind, 'move-meeting');
  if (moved.action.kind === 'move-meeting') {
    assert.equal(moved.action.eventId, 'm1');
    assert.equal(moved.action.day, '2026-11-06');
  }
});

test('asking about an existing meeting does not create a new one', () => {
  const turn = interpret('Cant make the meeting on the 30th, resceduele for next week', context({
    meetings: [{ id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-10-30', startMinute: 17 * 60, endMinute: 18 * 60 }],
  }));
  assert.equal(turn.action.kind, 'move-meeting');
  assert.notEqual(turn.action.kind, 'create-meeting');
});

test('pushing a project meeting to Nov 5 proposes a shared hour and does not ask the model', () => {
  const turn = interpret('Push the meeting in test 1 to Nov 5 and make sure it fits both of our availability timings', context({
    projects: [{ id: 'p1', name: 'Test 1', deadline: null }],
    meetings: [{ id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-11-02', startMinute: 16 * 60, endMinute: 17 * 60 }],
    members: [{ groupId: 'p1', userId: 'me' }, { groupId: 'p1', userId: 'them' }],
    schedules: [
      { userId: 'me', windows: [{ weekday: 4, startMinute: 16 * 60, endMinute: 21 * 60 }], unavailable: [] },
      { userId: 'them', windows: [{ weekday: 4, startMinute: 16 * 60, endMinute: 21 * 60 }], unavailable: [] },
    ],
  }));
  assert.equal(needsModel(turn), false);
  assert.equal(turn.action.kind, 'move-meeting');
  if (turn.action.kind === 'move-meeting') {
    assert.equal(turn.action.eventId, 'm1');
    assert.equal(turn.action.day, '2026-11-05');
    assert.equal(turn.action.startMinute, 16 * 60);
    assert.equal(turn.action.endMinute, 17 * 60);
  }
  assert.match(turn.reply, /both saved schedules/);
  assert.match(turn.reply, /Confirm/);
});

test('an open question is left for the model', () => {
  const turn = interpret('What does the rubric say about the poster?', context());
  assert.equal(needsModel(turn), true);
});

test('a dated reschedule uses an hour open for both people on that project', () => {
  const turn = interpret('Reschedeule the meeting for Test 1 to November 5th, at a availabale time for both of us', context({
    projects: [{ id: 'p1', name: 'Test 1', deadline: null }],
    meetings: [{ id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-10-30', startMinute: 16 * 60 + 43, endMinute: 17 * 60 + 45 }],
    members: [{ groupId: 'p1', userId: 'me' }, { groupId: 'p1', userId: 'them' }],
    schedules: [
      { userId: 'me', windows: [{ weekday: 4, startMinute: 16 * 60, endMinute: 21 * 60 }], unavailable: [] },
      { userId: 'them', windows: [{ weekday: 4, startMinute: 16 * 60 + 1, endMinute: 22 * 60 }], unavailable: [] },
    ],
  }));
  assert.equal(turn.action.kind, 'move-meeting');
  if (turn.action.kind === 'move-meeting') {
    assert.equal(turn.action.eventId, 'm1');
    assert.equal(turn.action.day, '2026-11-05');
    assert.equal(turn.action.startMinute, 16 * 60 + 30);
    assert.equal(turn.action.endMinute, 17 * 60 + 30);
  }
  assert.match(turn.reply, /Confirm/);
});

test('choosing an existing meeting continues the original request', () => {
  const base = context({
    projects: [{ id: 'p1', name: 'Test 1', deadline: null }],
    meetings: [{ id: 'm1', title: 'Meet 1', groupId: 'p1', groupName: 'Test 1', day: '2026-10-30', startMinute: 16 * 60, endMinute: 17 * 60 }],
    members: [{ groupId: 'p1', userId: 'me' }, { groupId: 'p1', userId: 'them' }],
    schedules: [
      { userId: 'me', windows: [{ weekday: 4, startMinute: 16 * 60, endMinute: 21 * 60 }], unavailable: [] },
      { userId: 'them', windows: [{ weekday: 4, startMinute: 16 * 60, endMinute: 21 * 60 }], unavailable: [] },
    ],
  });
  const turn = interpret('move a existing one', base, {
    kind: 'meeting-choice',
    source: 'Reschedeule the meeting for Test 1 to November 5th, at a availabale time for both of us',
  });
  assert.equal(turn.action.kind, 'move-meeting');
  if (turn.action.kind === 'move-meeting') assert.equal(turn.action.day, '2026-11-05');
  const alone = interpret('move a existing one', base);
  assert.match(alone.reply, /Which meeting/);
  assert.doesNotMatch(alone.reply, /task/i);
});

test('adjusting a named task proposes a new due date', () => {
  const turn = interpret('Adjust Algebra review to Friday.', context());
  assert.equal(turn.action.kind, 'move-task');
  if (turn.action.kind === 'move-task') assert.equal(turn.action.day, '2026-10-30');
});

test('a meeting uses a saved hour and waits for confirmation', () => {
  const turn = interpret('Find a time for our next team meeting.', context());
  assert.equal(turn.action.kind, 'create-meeting');
  if (turn.action.kind === 'create-meeting') {
    assert.equal(turn.action.day, '2026-10-25');
    assert.equal(turn.action.startMinute, 18 * 60);
  }
});

test('an update draft is not posted by the router', () => {
  const turn = interpret('Post an update about what I completed.', context({
    tasks: [task({ id: 'done', title: 'Finished the outline', status: 'completed' })],
  }));
  assert.equal(turn.action.kind, 'post-update');
  if (turn.action.kind === 'post-update') assert.match(turn.action.accomplishments, /Finished the outline/);
});

test('being behind schedule proposes moves and does not apply them', () => {
  const turn = interpret("We're behind schedule. Help us get back on track.", context({
    windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
  }));
  assert.equal(turn.action.kind, 'reschedule');
  assert.match(turn.reply, /confirm/i);
});

test('a repeated save does not write the task or the meeting twice', async () => {
  let writes = 0;
  const store = {
    taskDue: async () => '2026-10-30T17:00:00.000Z',
    updateTask: async () => {
      writes += 1;
      return null;
    },
    findLog: async () => writes > 0,
    insertLog: async () => {
      writes += 1;
      return null;
    },
    findEvent: async () => false,
    insertEvent: async () => ({ id: 'event-1', error: null }),
    insertMeeting: async () => null,
    updateEvent: async () => null,
    updateMeetingTimes: async () => null,
  };
  const first = await saveMovedTask(store, 't1', '2026-10-30');
  const second = await saveMovedTask(store, 't1', '2026-10-30');
  assert.match(first, /already/);
  assert.match(second, /already/);
  assert.equal(writes, 0);
  const posted = await saveUpdate({ ...store, findLog: async () => false }, 'p1', 'Finished the outline');
  const again = await saveUpdate(store, 'p1', 'Finished the outline');
  assert.match(posted, /posted/);
  assert.match(again, /already posted/);
  let events = 0;
  const meetingStore = {
    ...store,
    findEvent: async () => events > 0,
    insertEvent: async () => {
      events += 1;
      return { id: 'event-1', error: null };
    },
  };
  await saveMeeting(meetingStore, { groupId: 'p1', title: 'Team meeting', day: '2026-10-25', startMinute: 18 * 60, endMinute: 19 * 60 });
  const repeat = await saveMeeting(meetingStore, { groupId: 'p1', title: 'Team meeting', day: '2026-10-25', startMinute: 18 * 60, endMinute: 19 * 60 });
  assert.match(repeat, /already/);
  assert.equal(events, 1);
});
