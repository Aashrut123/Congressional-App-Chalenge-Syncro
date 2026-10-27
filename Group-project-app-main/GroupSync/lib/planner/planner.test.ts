import assert from 'node:assert/strict';
import test from 'node:test';

import { describePlanChanges, nextPersistenceStep, partitionPlanTasks } from './changes.ts';
import { findConflicts, overloadedDays } from './conflicts.ts';
import { atLocalTime, formatDay, isStillScheduled, overlapsLocalDay, stampInRange } from './dates.ts';
import { draftFromPlan, moveTask, removeTask, updateTask, validateDraft } from './draft.ts';
import { buildFallbackPlan } from './fallback.ts';
import { generatePlan } from './generate.ts';
import { canPromoteMember, canRemoveMember } from './permissions.ts';
import { acceptedChanges, proposeReschedule } from './reschedule.ts';
import { completionPercent, milestoneTaskProgress, nextTaskStatus } from './status.ts';
import type { GeneratedPlan, PlannerInput, PlannerMember, RescheduleTask } from './types.ts';
import { parseGeneratedPlan, validatePlanRequest, validatePlannerInput } from './validate.ts';

const member = (id: string, name: string, extra: Partial<PlannerMember> = {}): PlannerMember => ({
  id,
  name,
  skills: '',
  weeklyHours: 6,
  availableWeekdays: [1, 2, 3, 4, 5],
  unavailable: [],
  ...extra,
});

const input = (extra: Partial<PlannerInput> = {}): PlannerInput => ({
  title: 'Robotics notebook',
  outcome: 'Ship a demo notebook the judges can follow.',
  startDate: '2026-11-02',
  deadline: '2026-11-20',
  priority: 'high',
  weeklyHoursDefault: 6,
  notes: 'No meetings on Sundays.',
  milestones: [{ title: 'Prototype chassis', date: '2026-11-10' }],
  members: [member('a', 'Anish', { skills: 'chassis wiring' }), member('b', 'Aashrut', { skills: 'notebook writing' })],
  existingTasks: [{ title: 'Order parts', status: 'completed' }],
  ...extra,
});

test('local due times stay on the chosen calendar day', () => {
  const due = atLocalTime('2026-11-03', 17, 30);
  assert.ok(due);
  assert.equal(formatDay(due), '2026-11-03');
  assert.equal(due.getHours(), 17);
  assert.equal(due.getMinutes(), 30);
  assert.equal(atLocalTime('2026-02-31', 10), null);
  assert.equal(atLocalTime('2026-11-03', 24, 0), null);
});

test('task status moves through blocked before completed', () => {
  assert.equal(nextTaskStatus('todo'), 'in_progress');
  assert.equal(nextTaskStatus('in_progress'), 'blocked');
  assert.equal(nextTaskStatus('blocked'), 'completed');
  assert.equal(nextTaskStatus('completed'), 'todo');
});

test('project progress counts each task once', () => {
  assert.equal(completionPercent([]), 0);
  assert.equal(completionPercent([{ status: 'completed' }, { status: 'todo' }]), 50);
  assert.equal(completionPercent([{ status: 'completed' }]), 100);
  assert.deepEqual(milestoneTaskProgress([]), { done: 0, total: 0, percent: 0 });
  assert.equal(milestoneTaskProgress([
    { status: 'completed' },
    { status: 'todo' },
    { status: 'todo' },
    { status: 'todo' },
  ]).percent, 25);
});

test('membership rules match the database checks', () => {
  assert.equal(canRemoveMember('member', 'member', false).allowed, false);
  assert.equal(canRemoveMember('owner', 'owner', true).allowed, false);
  assert.equal(canRemoveMember('admin', 'admin', false).allowed, false);
  assert.equal(canRemoveMember('admin', 'member', false).allowed, true);
  assert.equal(canPromoteMember('owner', 'member'), true);
  assert.equal(canPromoteMember('admin', 'member'), false);
});

test('planner input rejects a deadline before the start', () => {
  const result = validatePlannerInput(input({ deadline: '2026-10-01' }));
  assert.equal(result.ok, false);
});

test('fallback plan avoids unavailable days and does not duplicate finished work', () => {
  const plan = buildFallbackPlan(input({
    members: [
      member('a', 'Anish', { unavailable: [{ start: '2026-11-02', end: '2026-11-06' }] }),
      member('b', 'Aashrut', { skills: 'notebook' }),
    ],
  }));
  assert.equal(plan.source, 'fallback');
  assert.ok(plan.tasks.length >= 3);
  assert.ok(plan.tasks.some((task) => task.assigneeId === 'b'));
  assert.equal(plan.tasks.some((task) => task.title === 'Order parts'), false);
  for (const task of plan.tasks) {
    if (task.assigneeId === 'a') {
      assert.ok(task.dueDate > '2026-11-06' || task.dueDate < '2026-11-02');
    }
  }
  assert.match(plan.summary, /hours|fit/i);
});

test('sprint pacing keeps a shorter buffer than flexible pacing', () => {
  const sprint = buildFallbackPlan(input({ pace: 'sprint', existingTasks: [] }));
  const flexible = buildFallbackPlan(input({ pace: 'flexible', existingTasks: [] }));
  assert.match(sprint.risks.join(' '), /last 1 day /);
  assert.match(flexible.risks.join(' '), /last 4 days /);
  assert.match(sprint.assumptions.join(' '), /Sprint pacing/);
  const sprintMid = sprint.tasks[Math.floor(sprint.tasks.length / 2)]?.dueDate ?? '';
  const flexibleMid = flexible.tasks[Math.floor(flexible.tasks.length / 2)]?.dueDate ?? '';
  assert.ok(sprintMid <= flexibleMid);
});

test('fallback plan is honest when the team has no days', () => {
  const plan = buildFallbackPlan(input({
    startDate: '2026-11-02',
    deadline: '2026-11-06',
    members: [member('a', 'Anish', { unavailable: [{ start: '2026-11-02', end: '2026-11-06' }] })],
  }));
  assert.equal(plan.feasible, false);
  assert.ok(plan.risks.length > 0);
});

test('AI responses must be structured and cannot invent dependencies', () => {
  const rejected = parseGeneratedPlan({ tasks: [{ title: 'Write' }] }, [{ id: 'a', name: 'Anish' }]);
  assert.equal(rejected.ok, false);
  const unknownDependency = parseGeneratedPlan({
    tasks: [{
      title: 'Write',
      description: 'Draft',
      phase: 'Build',
      assigneeId: 'missing',
      priority: 'high',
      estimatedMinutes: 60,
      startDate: '2026-11-03',
      dueDate: '2026-11-04',
      dependsOnTitles: ['Missing'],
      microGoals: ['Open the doc'],
    }],
  }, [{ id: 'a', name: 'Anish' }]);
  assert.equal(unknownDependency.ok, false);
  const accepted = parseGeneratedPlan({
    feasible: true,
    summary: 'Two steps.',
    assumptions: ['Hours are estimates.'],
    risks: [],
    phases: [{ name: 'Build', summary: 'Write it.' }],
    milestones: [],
    meetings: [],
    tasks: [{
      title: 'Write',
      description: 'Draft',
      phase: 'Build',
      assigneeId: 'missing',
      priority: 'high',
      estimatedMinutes: 60,
      startDate: '2026-11-03',
      dueDate: '2026-11-04',
      dependsOnTitles: [],
      microGoals: ['Open the doc'],
    }],
  }, [{ id: 'a', name: 'Anish' }]);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.tasks[0]?.assigneeId, null);
});

test('a plan request keeps only project fields and rejects a bad deadline', () => {
  const accepted = validatePlanRequest({
    title: 'Robot cart',
    outcome: 'Drive a measured course.',
    deadline: '2026-12-01',
    notes: 'Exams the week of Nov 16.',
    groupId: '11111111-1111-4111-8111-111111111111',
    ignored: 'not sent to the model',
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.notes.includes('Exams'), true);
  assert.equal(validatePlanRequest({ title: 'Robot cart' }).ok, false);
  assert.equal(validatePlanRequest({ title: 'Robot cart', outcome: 'Drive', deadline: 'yesterday' }).ok, false);
  assert.equal(validatePlanRequest({ title: 'Robot cart', outcome: 'Drive', groupId: 'not-an-id' }).ok, false);
});

test('circular dependencies are rejected', () => {
  const task = {
    description: 'Do the step.',
    phase: 'Build',
    assigneeId: null,
    priority: 'medium',
    estimatedMinutes: 60,
    startDate: '2026-11-03',
    dueDate: '2026-11-04',
    microGoals: [],
  };
  const circular = parseGeneratedPlan({
    summary: 'Two steps that wait on each other.',
    tasks: [
      { ...task, title: 'Frame', dependsOnTitles: ['Wheels'] },
      { ...task, title: 'Wheels', dependsOnTitles: ['Frame'] },
    ],
  }, [{ id: 'a', name: 'Anish' }]);
  assert.equal(circular.ok, false);
  if (!circular.ok) assert.match(circular.error, /circular/);
});

test('reschedule keeps completed tasks and drops them from accepted updates', () => {
  const tasks: RescheduleTask[] = [
    { id: 'done', title: 'Research', status: 'completed', dueDate: '2026-11-03', assigneeId: 'a', estimatedMinutes: 60, dependsOn: [] },
    { id: 'next', title: 'Draft', status: 'todo', dueDate: '2026-11-04', assigneeId: 'a', estimatedMinutes: 90, dependsOn: ['done'] },
  ];
  const proposal = proposeReschedule({
    tasks,
    members: [member('a', 'Anish', { unavailable: [{ start: '2026-11-04', end: '2026-11-07' }] })],
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    reason: 'Anish is out next week',
  });
  assert.deepEqual(proposal.unchangedCompleted, ['Research']);
  assert.equal(proposal.changes.some((change) => change.id === 'done'), false);
  const draft = proposal.changes.find((change) => change.id === 'next');
  assert.ok(draft);
  assert.ok((draft?.to ?? '') >= '2026-11-08');
  const applied = acceptedChanges(proposal, tasks, ['done', 'next']);
  assert.deepEqual(applied.map((item) => item.id), ['next']);
});

test('dependency cycles are reported instead of rewritten', () => {
  const proposal = proposeReschedule({
    tasks: [
      { id: 'a', title: 'A', status: 'todo', dueDate: null, assigneeId: 'a', estimatedMinutes: 30, dependsOn: ['b'] },
      { id: 'b', title: 'B', status: 'todo', dueDate: null, assigneeId: 'a', estimatedMinutes: 30, dependsOn: ['a'] },
    ],
    members: [member('a', 'Anish')],
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    reason: 'cycle',
  });
  assert.equal(proposal.feasible, false);
  assert.equal(proposal.changes.length, 0);
});

test('conflicts ignore deadlines and catch unavailable overlaps', () => {
  const conflicts = findConflicts([
    { id: '1', title: 'Standup', start: '2026-11-03T16:00:00.000Z', end: '2026-11-03T17:00:00.000Z', kind: 'meeting' },
    { id: '2', title: 'Lab', start: '2026-11-03T16:30:00.000Z', end: '2026-11-03T18:00:00.000Z', kind: 'event' },
    { id: '3', title: 'Submit', start: '2026-11-03T16:30:00.000Z', end: '2026-11-03T16:30:00.000Z', kind: 'deadline' },
    { id: '4', title: 'Away', start: '2026-11-03T00:00:00.000Z', end: '2026-11-04T00:00:00.000Z', kind: 'unavailable' },
  ]);
  assert.equal(conflicts.some((item) => item.a === 'Submit' || item.b === 'Submit'), false);
  assert.equal(conflicts.some((item) => item.reason.includes('overlap')), true);
  assert.equal(conflicts.some((item) => item.reason.includes('unavailable')), true);
  assert.deepEqual(overloadedDays([
    { dueDate: '2026-11-03', estimatedMinutes: 90, status: 'todo' },
    { dueDate: '2026-11-03', estimatedMinutes: 90, status: 'completed' },
  ], 60), [{ day: '2026-11-03', minutes: 90 }]);
});

test('an away period covers every day from its start through its end', () => {
  assert.equal(stampInRange('2026-10-24', '2026-10-26', '2026-10-24'), true);
  assert.equal(stampInRange('2026-10-24', '2026-10-26', '2026-10-25'), true);
  assert.equal(stampInRange('2026-10-24', '2026-10-26', '2026-10-26'), true);
  assert.equal(stampInRange('2026-10-24', '2026-10-26', '2026-10-27'), false);
  assert.equal(stampInRange('2026-10-24', '2026-10-26', '2026-10-23'), false);
  assert.equal(stampInRange('2026-10-24', '', '2026-10-24'), true);
  assert.equal(stampInRange('2026-10-24', '', '2026-10-25'), false);
});

test('a meeting is no longer upcoming after it ends', () => {
  const now = new Date('2026-10-19T18:00:00.000Z');
  assert.equal(isStillScheduled('2026-10-19T17:00:00.000Z', now), false);
  assert.equal(isStillScheduled('2026-10-19T19:00:00.000Z', now), true);
});

function samplePlan(): GeneratedPlan {
  const parsed = parseGeneratedPlan({
    summary: 'Frame the cart, then add wheels.',
    phases: [
      { name: 'Build', summary: 'Make the first version.' },
      { name: 'Finish', summary: 'Make it roll.' },
    ],
    milestones: [{ title: 'Rolls', dueDate: '2026-11-08' }],
    tasks: [
      {
        title: 'Frame',
        description: 'Build the frame.',
        phase: 'Build',
        priority: 'high',
        estimatedMinutes: 60,
        startDate: '2026-11-03',
        dueDate: '2026-11-05',
        dependsOnTitles: [],
      },
      {
        title: 'Wheels',
        description: 'Attach the wheels.',
        phase: 'Build',
        priority: 'medium',
        estimatedMinutes: 90,
        startDate: '2026-11-06',
        dueDate: '2026-11-08',
        dependsOnTitles: ['Frame'],
      },
    ],
  }, []);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

test('a new project plan does not need a project id', () => {
  const created = validatePlanRequest({
    title: 'Robot cart',
    outcome: 'Drive a measured course.',
    operation: 'new',
    weeklyHoursDefault: 6,
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.value.groupId, null);
    assert.equal(created.value.operation, 'new');
    assert.equal(created.value.weeklyHours, 6);
  }
  assert.equal(validatePlanRequest({ title: 'Robot cart', outcome: 'Drive', operation: 'revise' }).ok, false);
  assert.equal(validatePlanRequest({
    title: 'Robot cart',
    outcome: 'Drive',
    operation: 'new',
    groupId: '11111111-1111-4111-8111-111111111111',
  }).ok, false);
  assert.equal(validatePlanRequest({ title: 'Robot cart', outcome: 'Drive', weeklyHoursDefault: 0 }).ok, false);
  assert.equal(validatePlanRequest({ title: 'Robot cart', outcome: 'Drive', deadline: '2026-11-01', startDate: '2026-11-03' }).ok, false);
});

test('a generated plan keeps model dates for the scheduler to judge', () => {
  const outside = parseGeneratedPlan(samplePlan(), [], { startDate: '2026-11-02', deadline: '2026-11-04' });
  assert.equal(outside.ok, true);
  const inside = parseGeneratedPlan(samplePlan(), [], { startDate: '2026-11-02', deadline: '2026-11-20' });
  assert.equal(inside.ok, true);
});

test('a draft can be edited before it is saved', () => {
  const draft = draftFromPlan(samplePlan());
  const frame = draft.tasks.find((task) => task.title === 'Frame');
  const wheels = draft.tasks.find((task) => task.title === 'Wheels');
  assert.ok(frame && wheels);
  const renamed = updateTask(draft, frame.id, { title: 'Cut the frame' });
  const checked = validateDraft(renamed, { startDate: '2026-11-02', deadline: '2026-11-20' });
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.equal(checked.value.tasks[0]?.title, 'Cut the frame');
    assert.equal(checked.value.tasks[1]?.dependsOnTitles[0], 'Cut the frame');
    assert.equal(checked.value.tasks[0]?.assigneeId, null);
  }
  const removed = removeTask(renamed, frame.id);
  assert.deepEqual(removed.detached, ['Wheels']);
  assert.equal(removed.draft.tasks.find((task) => task.id === wheels.id)?.dependsOn.length, 0);
  const afterRemoval = validateDraft(removed.draft, { startDate: '2026-11-02', deadline: '2026-11-20' });
  assert.equal(afterRemoval.ok, true);
  const duplicate = updateTask(draft, wheels.id, { title: 'Frame' });
  assert.equal(validateDraft(duplicate, { startDate: '2026-11-02', deadline: '2026-11-20' }).ok, false);
  const reordered = moveTask(draft, wheels.id, -1);
  assert.equal(reordered.tasks[0]?.title, 'Wheels');
});

test('saving a revision keeps completed work and does not create a second project', () => {
  const tasks = samplePlan().tasks;
  const split = partitionPlanTasks(
    [
      { title: 'Frame', status: 'completed' },
      { title: 'Wheels', status: 'todo' },
    ],
    [...tasks, { ...tasks[0], title: 'Paint' }],
  );
  assert.deepEqual(split.preserved, ['Frame']);
  assert.deepEqual(split.skipped, ['Wheels']);
  assert.deepEqual(split.save.map((task) => task.title), ['Paint']);
  const described = describePlanChanges(
    [{ title: 'Frame', status: 'completed' }],
    tasks,
  );
  assert.deepEqual(described.preserve, ['Frame']);
  assert.deepEqual(described.add, ['Wheels']);
  assert.equal(nextPersistenceStep('new', null), 'create');
  assert.equal(nextPersistenceStep('new', 'project-1'), 'save');
  assert.equal(nextPersistenceStep('revise', null), 'blocked');
  assert.equal(nextPersistenceStep('revise', 'project-1'), 'save');
});

test('a missing deadline still produces a reviewable draft', () => {
  const open = validatePlannerInput(input({ deadline: '', operation: 'new' }));
  assert.equal(open.ok, true);
  const plan = buildFallbackPlan(input({ deadline: '', projectType: 'Congressional App Challenge' }));
  assert.ok(plan.tasks.length > 0);
  assert.ok(plan.phases.some((phase) => phase.name === 'Define the app'));
  assert.match(plan.assumptions.join(' '), /four-week window/);
});

test('generatePlan rejects invalid input and does not invent a plan when the provider is unreachable', async () => {
  await assert.rejects(
    () => generatePlan(input({ title: ' ' }), { useAi: true, supabaseUrl: 'http://127.0.0.1:9', accessToken: 'token' }),
    /title/i,
  );
  await assert.rejects(
    () => generatePlan(input({ operation: 'new' }), {
      useAi: true,
      supabaseUrl: 'http://127.0.0.1:9',
      accessToken: 'token',
      timeoutMs: 400,
    }),
    /could not be reached|timed out/i,
  );
});

test('a meeting shows on the local day it occupies', () => {
  const day = new Date(2026, 9, 19);
  const start = new Date(2026, 9, 19, 16, 0, 0);
  const end = new Date(2026, 9, 19, 17, 0, 0);
  assert.equal(overlapsLocalDay(start.toISOString(), end.toISOString(), day), true);
  assert.equal(overlapsLocalDay(start.toISOString(), end.toISOString(), new Date(2026, 9, 20)), false);
  const late = new Date(2026, 9, 18, 23, 30, 0);
  const afterMidnight = new Date(2026, 9, 19, 0, 30, 0);
  assert.equal(overlapsLocalDay(late.toISOString(), afterMidnight.toISOString(), day), true);
});
