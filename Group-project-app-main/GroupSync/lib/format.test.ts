import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeWallClock, encodeWallClock, formatClockFace, formatDate, formatTime, pickedInstant } from './format.ts';

test('a date-only deadline stays on that calendar day', () => {
  const formatted = formatDate('2026-10-24');
  assert.match(formatted, /24/);
  assert.doesNotMatch(formatted, /23/);
});

test('formatTime uses the timezone it is given', () => {
  const formatted = formatTime('2026-10-24T00:30:00.000Z', 'America/Chicago');
  assert.match(formatted, /7:30/);
});

test('a 9 pm choice stays 9 pm instead of shifting five hours', () => {
  const picked = new Date(2026, 9, 24, 21, 0, 0, 0);
  const stored = encodeWallClock(picked);
  assert.match(formatClockFace(stored), /9:00/);
  assert.doesNotMatch(formatClockFace(stored), /4:00/);
  const edited = decodeWallClock(stored);
  assert.equal(edited.getHours(), 21);
  assert.equal(edited.getMinutes(), 0);
});

test('9 pm central is still upcoming at 6 pm central', () => {
  const due = pickedInstant('2026-10-24T21:00:00.000Z', 'America/Chicago');
  const evening = new Date('2026-10-24T23:38:00.000Z');
  assert.ok(due.getTime() > evening.getTime());
});
