import assert from 'node:assert/strict';
import test from 'node:test';

import { findSlot, placeTasks, type PlacementTask } from './slots.ts';

const nineToEleven = { weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 };

function task(partial: Partial<PlacementTask> & Pick<PlacementTask, 'id' | 'title'>): PlacementTask {
  return {
    minutes: 60,
    priority: 'medium',
    overdue: true,
    slotInvalid: false,
    current: null,
    dependsOn: [],
    shared: false,
    groupDeadline: null,
    ...partial,
  };
}

test('an overdue task moves into the next open availability block', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [nineToEleven],
    unavailable: [],
    busy: [],
    tasks: [task({ id: 'a', title: 'Practice set' })],
  });
  assert.equal(result.stuck.length, 0);
  assert.equal(result.moves[0]?.day, '2026-10-27');
  assert.equal(result.moves[0]?.startMinute, 9 * 60);
  assert.equal(result.moves[0]?.endMinute, 10 * 60);
});

test('a task with no availability stays unscheduled', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [],
    unavailable: [],
    busy: [],
    tasks: [task({ id: 'a', title: 'Practice set' })],
  });
  assert.equal(result.moves.length, 0);
  assert.match(result.stuck[0]?.reason ?? '', /No availability is saved/);
});

test('a 60 minute task does not use a 30 minute gap', () => {
  const slot = findSlot({
    durationMinutes: 60,
    earliest: { day: '2026-10-27', minute: 0 },
    windows: [{ weekday: 2, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }],
    unavailable: [],
    busy: [],
  });
  assert.equal(slot.ok, false);
  if (!slot.ok) assert.match(slot.reason, /60 minutes/);
});

test('a meeting blocks the first hour and the task takes the next hour', () => {
  const slot = findSlot({
    durationMinutes: 60,
    earliest: { day: '2026-10-27', minute: 0 },
    windows: [nineToEleven],
    unavailable: [],
    busy: [{ day: '2026-10-27', startMinute: 9 * 60, endMinute: 10 * 60 }],
  });
  assert.equal(slot.ok, true);
  if (slot.ok) {
    assert.equal(slot.startMinute, 10 * 60);
    assert.equal(slot.endMinute, 11 * 60);
  }
});

test('a rescheduled task ends on the hour or half hour when the window allows it', () => {
  const slot = findSlot({
    durationMinutes: 60,
    earliest: { day: '2026-10-25', minute: 0 },
    windows: [{ weekday: 0, startMinute: 16 * 60, endMinute: 21 * 60 }],
    unavailable: [],
    busy: [{ day: '2026-10-25', startMinute: 16 * 60, endMinute: 18 * 60 + 43 }],
  });
  assert.equal(slot.ok, true);
  if (slot.ok) {
    assert.equal(slot.startMinute, 19 * 60);
    assert.equal(slot.endMinute, 20 * 60);
  }
});

test('a rescheduled task ends on the half hour when that is the earliest fit', () => {
  const slot = findSlot({
    durationMinutes: 60,
    earliest: { day: '2026-10-25', minute: 0 },
    windows: [{ weekday: 0, startMinute: 16 * 60, endMinute: 21 * 60 }],
    unavailable: [],
    busy: [{ day: '2026-10-25', startMinute: 16 * 60, endMinute: 18 * 60 + 10 }],
  });
  assert.equal(slot.ok, true);
  if (slot.ok) {
    assert.equal(slot.startMinute, 18 * 60 + 30);
    assert.equal(slot.endMinute, 19 * 60 + 30);
  }
});

test('a rescheduled task keeps its end when the window cannot hold :00 or :30', () => {
  const slot = findSlot({
    durationMinutes: 40,
    earliest: { day: '2026-10-27', minute: 0 },
    windows: [{ weekday: 2, startMinute: 9 * 60 + 10, endMinute: 9 * 60 + 55 }],
    unavailable: [],
    busy: [],
  });
  assert.equal(slot.ok, true);
  if (slot.ok) {
    assert.equal(slot.startMinute, 9 * 60 + 10);
    assert.equal(slot.endMinute, 9 * 60 + 50);
  }
});

test('a task is never placed outside the saved window', () => {
  const slot = findSlot({
    durationMinutes: 60,
    earliest: { day: '2026-10-27', minute: 0 },
    windows: [nineToEleven],
    unavailable: [],
    busy: [],
  });
  assert.equal(slot.ok, true);
  if (slot.ok) {
    assert.ok(slot.startMinute >= 9 * 60);
    assert.ok(slot.endMinute <= 11 * 60);
  }
});

test('the higher priority overdue task takes the only hour', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 }],
    unavailable: [],
    busy: [],
    tasks: [
      task({ id: 'low', title: 'Later', priority: 'low' }),
      task({ id: 'high', title: 'First', priority: 'high' }),
    ],
  });
  assert.equal(result.moves[0]?.id, 'high');
  assert.equal(result.moves[0]?.day, '2026-10-27');
  assert.equal(result.moves[1]?.id, 'low');
  assert.ok((result.moves[1]?.day ?? '') > '2026-10-27');
});

test('a dependent task waits and a project deadline is not moved', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [],
    unavailable: [],
    busy: [],
    tasks: [
      task({ id: 'parent', title: 'Read chapter' }),
      task({ id: 'child', title: 'Problem set', dependsOn: ['parent'], groupDeadline: '2026-10-27' }),
    ],
  });
  assert.equal(result.moves.length, 0);
  assert.match(result.stuck.find((item) => item.id === 'child')?.reason ?? '', /waits on/);
  assert.equal(JSON.stringify(result).includes('"deadline"'), false);
});

test('a task whose saved time is no longer inside availability moves', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [{ weekday: 3, startMinute: 16 * 60, endMinute: 18 * 60 }],
    unavailable: [],
    busy: [],
    tasks: [task({
      id: 'a',
      title: 'Lab',
      overdue: false,
      slotInvalid: true,
      current: { day: '2026-10-27', startMinute: 9 * 60, endMinute: 10 * 60 },
    })],
  });
  assert.equal(result.moves[0]?.day, '2026-10-28');
  assert.equal(result.moves[0]?.startMinute, 16 * 60);
});

test('an unaligned saved time moves to the hour or half hour and stays there', () => {
  const windows = [{ weekday: 0, startMinute: 16 * 60, endMinute: 21 * 60 }];
  const first = placeTasks({
    now: { day: '2026-10-25', minute: 18 * 60 + 20 },
    windows,
    unavailable: [],
    busy: [],
    tasks: [task({
      id: 'a',
      title: 'Time blocking',
      overdue: false,
      slotInvalid: true,
      current: { day: '2026-10-25', startMinute: 17 * 60 + 43, endMinute: 18 * 60 + 43 },
    })],
  });
  assert.equal(first.moves.length, 1);
  assert.equal(first.moves[0]?.endMinute % 30, 0);
  const again = placeTasks({
    now: { day: '2026-10-25', minute: 18 * 60 + 20 },
    windows,
    unavailable: [],
    busy: [],
    tasks: [task({
      id: 'a',
      title: 'Time blocking',
      overdue: false,
      slotInvalid: false,
      current: {
        day: first.moves[0]?.day ?? '',
        startMinute: first.moves[0]?.startMinute ?? 0,
        endMinute: first.moves[0]?.endMinute ?? 0,
      },
    })],
  });
  assert.equal(again.moves.length, 0);
});

test('refreshing does not move a task that is already in its slot', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [nineToEleven],
    unavailable: [],
    busy: [],
    tasks: [task({
      id: 'a',
      title: 'Practice set',
      overdue: false,
      slotInvalid: false,
      current: { day: '2026-10-27', startMinute: 9 * 60, endMinute: 10 * 60 },
    })],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.stuck.length, 0);
});

test('a shared task is flagged instead of moving a group deadline', () => {
  const result = placeTasks({
    now: { day: '2026-10-27', minute: 8 * 60 },
    windows: [nineToEleven],
    unavailable: [],
    busy: [],
    tasks: [task({ id: 'a', title: 'Demo', shared: true, groupDeadline: '2026-10-20' })],
  });
  assert.equal(result.moves.length, 0);
  assert.match(result.stuck[0]?.reason ?? '', /shared/);
});
