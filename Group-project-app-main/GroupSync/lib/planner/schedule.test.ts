import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionPlanTasks } from './changes.ts';
import { schedulePlan, type CapacityMember } from './schedule.ts';
import type { GeneratedPlan, PlanTask } from './types.ts';

const person = (id: string, name: string, extra: Partial<CapacityMember> = {}): CapacityMember => ({
  id,
  name,
  weeklyHours: 6,
  availableWeekdays: [1, 2, 3, 4, 5],
  unavailable: [],
  skills: '',
  ...extra,
});

function task(partial: Partial<PlanTask> & Pick<PlanTask, 'title'>): PlanTask {
  return {
    description: 'Done when the result is written down.',
    phase: 'Build',
    assigneeId: null,
    assigneeName: 'Unassigned',
    priority: 'medium',
    estimatedMinutes: 120,
    startDate: '2026-11-02',
    dueDate: '2026-11-03',
    dependsOnTitles: [],
    microGoals: ['Check the result'],
    alreadyTracked: false,
    ...partial,
  };
}

function plan(tasks: PlanTask[], extra: Partial<GeneratedPlan> = {}): GeneratedPlan {
  return {
    source: 'ai',
    notices: [],
    feasible: true,
    summary: 'A test plan.',
    assumptions: [],
    risks: [],
    questions: [],
    phases: [{ name: 'Build', summary: 'Do the work.' }],
    milestones: [{ title: 'Prototype', dueDate: '2026-11-20' }],
    meetings: [],
    criticalPath: [],
    workload: [],
    alternatives: [],
    tasks,
    ...extra,
  };
}

test('weekday and weekend session lengths are scheduled separately', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Weekend practice', estimatedMinutes: 180 }),
    task({ title: 'Algebra review', estimatedMinutes: 180, dependsOnTitles: ['Weekend practice'] }),
  ]), {
    startDate: '2026-10-25',
    deadline: '2026-11-20',
    weeklyHours: 10,
    notes: '1.5 hour weekday sessions, and 3 hour weekend sessions',
    members: [person('a', 'Anish')],
  });
  const weekend = scheduled.tasks.find((item) => item.title === 'Weekend practice');
  const algebra = scheduled.tasks.find((item) => item.title === 'Algebra review');
  assert.equal(weekend?.startDate, '2026-10-25');
  assert.ok((weekend?.dueDate ?? '') < (algebra?.dueDate ?? ''));
  assert.ok((algebra?.dueDate ?? '') <= '2026-11-20');
  assert.ok((algebra?.dueDate ?? '') >= '2026-11-10');
});

test('one hour per weekday keeps several hours out of four weekdays', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Diagnostic exam', estimatedMinutes: 180 }),
    task({ title: 'Algebra review', estimatedMinutes: 240, dependsOnTitles: ['Diagnostic exam'] }),
  ]), {
    startDate: '2026-10-26',
    deadline: '2026-11-20',
    weeklyHours: 10,
    notes: 'I can study 1 hour per weekday.',
    members: [person('a', 'Anish')],
  });
  const exam = scheduled.tasks.find((item) => item.title === 'Diagnostic exam');
  const algebra = scheduled.tasks.find((item) => item.title === 'Algebra review');
  assert.equal(exam?.startDate, '2026-10-26');
  assert.ok((exam?.dueDate ?? '') > '2026-10-26');
  assert.ok((algebra?.dueDate ?? '') > (exam?.dueDate ?? ''));
  assert.ok((algebra?.dueDate ?? '') >= '2026-11-16');
  assert.ok((algebra?.dueDate ?? '') <= '2026-11-20');
});

test('one hour on weekdays is the same daily cap', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Study block', estimatedMinutes: 120 }),
  ]), {
    startDate: '2026-10-26',
    deadline: '2026-10-27',
    weeklyHours: 10,
    notes: 'one hour on weekdays',
    members: [person('a', 'Anish')],
  });
  assert.equal(scheduled.tasks[0]?.startDate, '2026-10-26');
  assert.equal(scheduled.tasks[0]?.dueDate, '2026-10-27');
});

test('a one hour overflow is not written as 1 hours', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Build everything', estimatedMinutes: 180 }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-03',
    weeklyHours: 10,
    notes: '1 hour per weekday',
    members: [person('a', 'Anish')],
  });
  assert.match(scheduled.alternatives.join(' '), /1 hour(?!s)/);
  assert.doesNotMatch(scheduled.alternatives.join(' '), /1 hours/);
});

test('one hour per day keeps a two-hour task off a single day', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Study block', estimatedMinutes: 120 }),
  ]), {
    startDate: '2026-10-26',
    deadline: '2026-10-27',
    weeklyHours: 10,
    notes: 'I can study 1 hour per day.',
    members: [person('a', 'Anish')],
  });
  assert.equal(scheduled.tasks[0]?.startDate, '2026-10-26');
  assert.equal(scheduled.tasks[0]?.dueDate, '2026-10-27');
});

test('one person gets sequential weekday dates and owns the work', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Frame the flow', estimatedMinutes: 120 }),
    task({ title: 'Build the grid', estimatedMinutes: 90, dependsOnTitles: ['Frame the flow'] }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  const first = scheduled.tasks.find((item) => item.title === 'Frame the flow');
  const second = scheduled.tasks.find((item) => item.title === 'Build the grid');
  assert.equal(scheduled.feasible, true);
  assert.equal(first?.assigneeId, 'a');
  assert.equal(first?.startDate, '2026-11-02');
  assert.ok((first?.dueDate ?? '') > '2026-11-03');
  assert.ok((second?.startDate ?? '') >= (first?.dueDate ?? ''));
  assert.ok((second?.dueDate ?? '') <= '2026-11-20');
  assert.ok((second?.dueDate ?? '') >= '2026-11-16');
  assert.equal(new Date(2026, 10, 7).getDay() === 6 || second?.startDate !== '2026-11-07', true);
  assert.ok(scheduled.criticalPath.join(' ').includes('Frame the flow'));
  assert.equal(scheduled.workload[0]?.name, 'Anish');
  assert.equal(scheduled.workload[0]?.minutes, 210);
});

test('different skills split independent work across people', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Draw the screens', description: 'Done when the design is visible.', estimatedMinutes: 120 }),
    task({ title: 'Write the overlap function', description: 'Done when the code returns shared hours.', estimatedMinutes: 120 }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    weeklyHours: 6,
    members: [
      person('a', 'Anish', { skills: 'design screens' }),
      person('b', 'Aashrut', { skills: 'code function' }),
    ],
  });
  const design = scheduled.tasks.find((item) => item.title === 'Draw the screens');
  const code = scheduled.tasks.find((item) => item.title === 'Write the overlap function');
  assert.equal(design?.assigneeId, 'a');
  assert.equal(code?.assigneeId, 'b');
  assert.equal(design?.startDate, code?.startDate);
  assert.equal(scheduled.feasible, true);
});

test('an unrealistic deadline is not called feasible', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Build everything', estimatedMinutes: 480 }),
    task({ title: 'Test everything', estimatedMinutes: 480, dependsOnTitles: ['Build everything'] }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-03',
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  assert.equal(scheduled.feasible, false);
  assert.ok(scheduled.tasks.some((item) => item.dueDate > '2026-11-03'));
  assert.ok(scheduled.alternatives.length > 0);
  assert.match(scheduled.risks.join(' '), /does not fit/i);
});

test('open work already on one person is given to someone with time', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Write the report', estimatedMinutes: 60 }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    weeklyHours: 6,
    members: [person('a', 'Anish'), person('b', 'Aashrut')],
    existingTasks: [{ title: 'Old research', status: 'todo', assigneeId: 'a', estimatedMinutes: 480, dueDate: '2026-10-01' }],
  });
  assert.equal(scheduled.tasks[0]?.assigneeId, 'b');
  assert.match(scheduled.risks.join(' '), /overdue/i);
});

test('a missing deadline is questioned and invalid dates are rejected', () => {
  const open = schedulePlan(plan([task({ title: 'Start' })]), {
    startDate: '2026-11-02',
    deadline: null,
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  assert.match(open.questions.join(' '), /finished|four-week/i);
  const invalid = schedulePlan(plan([task({ title: 'Start' })]), {
    startDate: '2026-11-20',
    deadline: '2026-11-02',
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  assert.equal(invalid.feasible, false);
  assert.equal(invalid.tasks[0]?.dueDate, '2026-11-03');
});

test('a dependency cycle is reported instead of rewritten', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Frame', dependsOnTitles: ['Wheels'] }),
    task({ title: 'Wheels', dependsOnTitles: ['Frame'] }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  assert.equal(scheduled.feasible, false);
  assert.match(scheduled.alternatives.join(' '), /loop/i);
  assert.equal(scheduled.tasks[0]?.dueDate, '2026-11-03');
});

test('a confirmed plan is not saved twice when the same titles already exist', () => {
  const scheduled = schedulePlan(plan([
    task({ title: 'Frame the flow' }),
    task({ title: 'Build the grid', dependsOnTitles: ['Frame the flow'] }),
  ]), {
    startDate: '2026-11-02',
    deadline: '2026-11-20',
    weeklyHours: 6,
    members: [person('a', 'Anish')],
  });
  const firstSave = partitionPlanTasks([], scheduled.tasks);
  assert.equal(firstSave.save.length, 2);
  const reload = partitionPlanTasks(
    scheduled.tasks.map((item) => ({ title: item.title, status: 'todo' })),
    scheduled.tasks,
  );
  assert.equal(reload.save.length, 0);
  assert.equal(reload.skipped.length, 2);
});
