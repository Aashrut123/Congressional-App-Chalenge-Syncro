import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarStamp,
  clampMonthDay,
  nextOccurrence,
  repeatDates,
  parseRule,
  presetForRule,
  ruleFromPreset,
  ruleSummary,
  tasksForProgress,
  validateRule,
} from './recurrence.ts';

function at(year: number, month: number, day: number, hour = 21): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

test('daily recurrence keeps the same clock', () => {
  const rule = ruleFromPreset('daily', at(2026, 10, 24));
  assert.ok(rule);
  const next = nextOccurrence(at(2026, 10, 24), rule, 1);
  assert.equal(calendarStamp(next!), '2026-10-25');
  assert.equal(next?.getHours(), 21);
});

test('biweekly dates land every 14 days', () => {
  const due = at(2026, 10, 25);
  const rule = ruleFromPreset('biweekly', due);
  assert.ok(rule);
  const dates = repeatDates(due, rule, 0, 40, 10).map((date) => calendarStamp(date));
  assert.deepEqual(dates, ['2026-10-25', '2026-11-08', '2026-11-22']);
});

test('weekday recurrence skips Saturday and Sunday', () => {
  const friday = at(2026, 10, 23);
  const rule = ruleFromPreset('weekday', friday);
  assert.ok(rule);
  const next = nextOccurrence(friday, rule, 1);
  assert.equal(calendarStamp(next!), '2026-10-26');
});

test('weekly recurrence on selected days', () => {
  const monday = at(2026, 10, 26);
  const rule = ruleFromPreset('custom', monday);
  assert.ok(rule);
  rule.frequency = 'weekly';
  rule.weekdays = [1, 3];
  const wednesday = nextOccurrence(monday, rule, 1);
  const nextMonday = nextOccurrence(wednesday!, rule, 2);
  assert.equal(calendarStamp(wednesday!), '2026-10-28');
  assert.equal(calendarStamp(nextMonday!), '2026-11-02');
  assert.match(ruleSummary(rule), /Monday and Wednesday/);
});

test('every two weeks lands on the same weekday', () => {
  const friday = at(2026, 10, 23);
  const rule = ruleFromPreset('biweekly', friday);
  assert.ok(rule);
  const next = nextOccurrence(friday, rule, 1);
  assert.equal(calendarStamp(next!), '2026-11-06');
  assert.equal(next?.getDay(), 5);
});

test('monthly recurrence on the 31st uses the last day of shorter months', () => {
  assert.equal(clampMonthDay(2026, 1, 31), 28);
  assert.equal(clampMonthDay(2024, 1, 31), 29);
  assert.equal(clampMonthDay(2026, 3, 31), 30);
  const rule = ruleFromPreset('monthly', at(2026, 1, 31));
  assert.ok(rule);
  const february = nextOccurrence(at(2026, 1, 31), rule, 1);
  const march = nextOccurrence(february!, rule, 2);
  const april = nextOccurrence(march!, rule, 3);
  assert.equal(calendarStamp(february!), '2026-02-28');
  assert.equal(calendarStamp(march!), '2026-03-31');
  assert.equal(calendarStamp(april!), '2026-04-30');
});

test('monthly recurrence on the 29th and 30th clamps in February', () => {
  const on29 = ruleFromPreset('monthly', at(2026, 1, 29));
  const on30 = ruleFromPreset('monthly', at(2026, 1, 30));
  assert.equal(calendarStamp(nextOccurrence(at(2026, 1, 29), on29!, 1)!), '2026-02-28');
  assert.equal(calendarStamp(nextOccurrence(at(2026, 1, 30), on30!, 1)!), '2026-02-28');
});

test('annual recurrence across a leap year', () => {
  const rule = ruleFromPreset('yearly', at(2024, 2, 29));
  assert.ok(rule);
  const next = nextOccurrence(at(2024, 2, 29), rule, 1);
  const leap = nextOccurrence(at(2027, 2, 28), rule, 4);
  assert.equal(calendarStamp(next!), '2025-02-28');
  assert.equal(calendarStamp(leap!), '2028-02-29');
});

test('a series stops on the end date and after a count', () => {
  const due = at(2026, 10, 24);
  const until = ruleFromPreset('daily', due)!;
  until.until = '2026-10-25';
  assert.equal(calendarStamp(nextOccurrence(due, until, 1)!), '2026-10-25');
  assert.equal(nextOccurrence(at(2026, 10, 25), until, 2), null);
  const counted = ruleFromPreset('daily', due)!;
  counted.count = 2;
  assert.ok(nextOccurrence(due, counted, 1));
  assert.equal(nextOccurrence(due, counted, 2), null);
});

test('invalid custom rules are rejected', () => {
  const due = at(2026, 10, 24);
  const rule = ruleFromPreset('custom', due)!;
  rule.frequency = 'weekly';
  rule.weekdays = [];
  assert.match(validateRule(rule), /weekday/);
  assert.equal(parseRule({ frequency: 'weekly', interval: 1, weekdays: [], anchor: '2026-10-24' }), null);
  assert.equal(presetForRule(null), 'none');
});

test('progress counts one open occurrence per series', () => {
  const listed = tasksForProgress([
    { id: 'a', status: 'completed', series_id: 's' },
    { id: 'b', status: 'todo', series_id: 's' },
    { id: 'c', status: 'todo', series_id: null },
    { id: 'd', status: 'completed', series_id: 's', skipped: true },
  ]);
  assert.deepEqual(listed.map((task) => task.id).sort(), ['b', 'c']);
});
