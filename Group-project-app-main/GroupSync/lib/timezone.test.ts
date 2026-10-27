import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_TIME_ZONE, overlapsZonedDay, preferredTimeZone, unavailableBounds, weekdayIndex, zonedDateTime, zonedDayStamp } from './timezone.ts';

test('Central is the default when a profile has no chosen zone', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'America/Chicago');
  assert.equal(preferredTimeZone(undefined), 'America/Chicago');
  assert.equal(preferredTimeZone(null), 'America/Chicago');
  assert.equal(preferredTimeZone(''), 'America/Chicago');
  assert.equal(preferredTimeZone('UTC'), 'America/Chicago');
  assert.equal(preferredTimeZone('America/New_York'), 'America/New_York');
});

test('an away date uses the profile timezone instead of UTC midnight', () => {
  const chicago = unavailableBounds('2026-07-15', '2026-07-15', 'America/Chicago');
  assert.equal(chicago.start, '2026-07-15T05:00:00.000Z');
  assert.equal(chicago.end, '2026-07-16T05:00:00.000Z');

  const eastern = unavailableBounds('2026-07-15', '2026-07-15', 'America/New_York');
  assert.equal(eastern.start, '2026-07-15T04:00:00.000Z');
  assert.equal(eastern.end, '2026-07-16T04:00:00.000Z');
});

test('Saturday evening in Central is still Saturday', () => {
  const saturdayNight = new Date('2026-10-25T01:31:00.000Z');
  assert.equal(zonedDayStamp(saturdayNight, 'America/Chicago'), '2026-10-24');
  assert.equal(weekdayIndex('2026-10-24'), 6);
  assert.equal(weekdayIndex('2026-10-25'), 0);
});

test('a late meeting stays on the chosen timezone day', () => {
  const day = new Date(2026, 6, 15);
  const evening = zonedDateTime(2026, 7, 15, 21, 0, 'America/Chicago').toISOString();
  const nextMorning = zonedDateTime(2026, 7, 16, 0, 30, 'America/Chicago').toISOString();
  assert.equal(overlapsZonedDay(evening, nextMorning, day, 'America/Chicago'), true);
  assert.equal(overlapsZonedDay(evening, nextMorning, new Date(2026, 6, 16), 'America/Chicago'), true);
  assert.equal(overlapsZonedDay(evening, nextMorning, new Date(2026, 6, 14), 'America/Chicago'), false);
});
