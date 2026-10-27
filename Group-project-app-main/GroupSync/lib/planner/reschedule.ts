import { addDays, eachDay, formatDay, parseDay } from './dates';
import type { PlannerMember, RescheduleProposal, RescheduleTask } from './types';

function unavailable(member: PlannerMember | undefined, day: Date): boolean {
  if (!member) return false;
  const key = formatDay(day);
  if (member.availableWeekdays.length && !member.availableWeekdays.includes(day.getDay())) return true;
  return member.unavailable.some((range) => key >= range.start.slice(0, 10) && key <= range.end.slice(0, 10));
}

function nextOpenDay(member: PlannerMember | undefined, start: Date, deadline: Date): Date | null {
  for (const day of eachDay(start, deadline)) {
    if (!unavailable(member, day)) return day;
  }
  return null;
}

function orderTasks(tasks: RescheduleTask[]): { ordered: RescheduleTask[]; cycle: boolean } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: RescheduleTask[] = [];
  let cycle = false;

  const visit = (task: RescheduleTask) => {
    if (visited.has(task.id) || cycle) return;
    if (visiting.has(task.id)) {
      cycle = true;
      return;
    }
    visiting.add(task.id);
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };

  for (const task of tasks) visit(task);
  return { ordered, cycle };
}

export function proposeReschedule(options: {
  tasks: RescheduleTask[];
  members: PlannerMember[];
  startDate: string;
  deadline: string;
  reason: string;
}): RescheduleProposal {
  const start = parseDay(options.startDate);
  const deadline = parseDay(options.deadline);
  const completed = options.tasks.filter((task) => task.status === 'completed');
  const open = options.tasks.filter((task) => task.status !== 'completed');
  if (!start || !deadline || deadline < start) {
    return {
      feasible: false,
      explanation: 'The project dates are invalid, so nothing was moved.',
      changes: [],
      unchangedCompleted: completed.map((task) => task.title),
      tradeoffs: ['Set a deadline on or after the start date before rescheduling.'],
    };
  }

  const { ordered, cycle } = orderTasks(open);
  if (cycle) {
    return {
      feasible: false,
      explanation: 'These tasks depend on each other in a loop, so a new order cannot be calculated.',
      changes: [],
      unchangedCompleted: completed.map((task) => task.title),
      tradeoffs: ['Remove a dependency cycle, then generate the proposal again.'],
    };
  }

  const dueById = new Map<string, string>();
  for (const task of completed) {
    if (task.dueDate) dueById.set(task.id, task.dueDate.slice(0, 10));
  }

  const changes: RescheduleProposal['changes'] = [];
  let cursor = start;
  let missed = 0;
  for (const task of ordered) {
    const member = options.members.find((item) => item.id === task.assigneeId);
    let earliest = cursor;
    for (const dependencyId of task.dependsOn) {
      const dependencyDue = dueById.get(dependencyId);
      const parsed = dependencyDue ? parseDay(dependencyDue) : null;
      if (parsed && addDays(parsed, 1) > earliest) earliest = addDays(parsed, 1);
    }
    const placed = nextOpenDay(member, earliest, deadline);
    const target = placed ?? deadline;
    if (!placed) missed += 1;
    dueById.set(task.id, formatDay(target));
    const nextCursor = addDays(target, 1);
    if (nextCursor > cursor) cursor = nextCursor;
    const nextDue = formatDay(target);
    if (task.dueDate?.slice(0, 10) === nextDue) continue;
    changes.push({
      id: task.id,
      title: task.title,
      from: task.dueDate ? task.dueDate.slice(0, 10) : null,
      to: nextDue,
      reason: placed
        ? `Moved after dependencies and ${member ? member.name : 'an open teammate'}'s available days.`
        : 'No available day fits before the deadline; the deadline itself is the proposed date.',
    });
  }

  const feasible = missed === 0;
  return {
    feasible,
    explanation: feasible
      ? `${changes.length} open task${changes.length === 1 ? '' : 's'} would move. Completed work stays where it is.`
      : `${missed} open task${missed === 1 ? '' : 's'} cannot fit before ${options.deadline}. Completed work was not changed.`,
    changes,
    unchangedCompleted: completed.map((task) => task.title),
    tradeoffs: [
      options.reason ? `Trigger: ${options.reason}` : 'Trigger: constraints changed.',
      'Accepting updates task deadlines only. Meetings and calendar events stay until you edit them.',
      feasible ? 'The new dates still land on or before the project deadline.' : 'Narrow the scope or move the deadline. The proposal will not pretend the date still works.',
    ],
  };
}

export function acceptedChanges(
  proposal: RescheduleProposal,
  tasks: RescheduleTask[],
  acceptedIds: string[],
): { id: string; dueDate: string }[] {
  const completed = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id));
  return proposal.changes
    .filter((change) => acceptedIds.includes(change.id) && !completed.has(change.id))
    .map((change) => ({ id: change.id, dueDate: change.to }));
}
