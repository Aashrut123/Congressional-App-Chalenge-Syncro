import { addDays, daySpan, formatDay, parseDay } from './dates.ts';
import type { GeneratedPlan, PlanTask } from './types.ts';

export interface CapacityMember {
  id: string;
  name: string;
  weeklyHours: number;
  availableWeekdays: number[];
  unavailable: { start: string; end: string }[];
  skills: string;
}

export interface ExistingLoad {
  title: string;
  status: string;
  assigneeId?: string | null;
  estimatedMinutes?: number | null;
  dueDate?: string | null;
}

export interface ScheduleOptions {
  startDate: string | null;
  deadline: string | null;
  weeklyHours: number | null;
  members: CapacityMember[];
  existingTasks?: ExistingLoad[];
  /** Outcome, notes, and revision text. A phrase like "1 hour per day" caps the daily schedule. */
  notes?: string;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

const weekdayDefault = [1, 2, 3, 4, 5];

function weekdaysOf(member: CapacityMember): number[] {
  return member.availableWeekdays.length ? member.availableWeekdays : weekdayDefault;
}

interface SessionCaps {
  weekday: number | null;
  weekend: number | null;
  any: number | null;
}

function isWeekend(day: Date): boolean {
  const value = day.getDay();
  return value === 0 || value === 6;
}

function isWorkingDay(member: CapacityMember, day: Date, caps: SessionCaps): boolean {
  const allowed = weekdaysOf(member).includes(day.getDay()) || (isWeekend(day) && caps.weekend != null);
  if (!allowed) return false;
  const key = formatDay(day);
  return !member.unavailable.some((range) => key >= range.start.slice(0, 10) && key <= range.end.slice(0, 10));
}

function statedDailyMinutes(text: string): number | null {
  const source = text.replace(/weekdays?/gi, 'day');
  const numeric = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:per|a|an|each|\/|on)\s*days?/i.exec(source);
  if (numeric) return Math.max(15, Math.round(Number(numeric[1]) * 60));
  const minutes = /(\d+)\s*(?:minutes?|mins?)\s*(?:per|a|an|each|\/|on)\s*days?/i.exec(source);
  if (minutes) return Math.max(15, Math.round(Number(minutes[1])));
  if (/\b(?:an|one)\s+hours?\s+(?:per|a|an|each|on)\s+days?\b/i.test(source)) return 60;
  return null;
}

function hoursLabel(hours: number): string {
  const count = Math.max(1, Math.round(hours));
  return `${count} hour${count === 1 ? '' : 's'}`;
}

function amountMinutes(amount: string, unit: string): number {
  const value = Number(amount);
  if (/min/i.test(unit)) return Math.max(15, Math.round(value));
  return Math.max(15, Math.round(value * 60));
}

function statedSessionCaps(text: string): SessionCaps {
  const caps: SessionCaps = { weekday: null, weekend: null, any: null };
  const normalized = text
    .replace(/\ban hour and a half\b/gi, '1.5 hours')
    .replace(/\bone and a half\b/gi, '1.5')
    .replace(/\b(one|two|three|four)\b/gi, (word) => ({ one: '1', two: '2', three: '3', four: '4' }[word.toLowerCase()] ?? word));
  const assign = (kind: string, minutes: number) => {
    if (/weekend/i.test(kind)) caps.weekend = minutes;
    else caps.weekday = minutes;
  };
  const leading = /(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|minutes?|mins?)\s+(?:long\s+)?(?:per\s+|a\s+|an\s+|each\s+|on\s+|\/\s*)?(weekdays?|weekends?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = leading.exec(normalized))) assign(match[3], amountMinutes(match[1], match[2]));
  const trailing = /\b(weekdays?|weekends?)\b[^.\n]{0,40}?(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|minutes?|mins?)\b/gi;
  while ((match = trailing.exec(normalized))) {
    if (/weekend/i.test(match[1]) ? caps.weekend != null : caps.weekday != null) continue;
    assign(match[1], amountMinutes(match[2], match[3]));
  }
  if (caps.weekday == null && caps.weekend == null) caps.any = statedDailyMinutes(text);
  return caps;
}

function budgetFor(member: CapacityMember, day: Date, fallbackHours: number, caps: SessionCaps): number {
  const hours = member.weeklyHours > 0 ? member.weeklyHours : fallbackHours;
  const openDays = new Set(weekdaysOf(member));
  if (caps.weekend != null) {
    openDays.add(0);
    openDays.add(6);
  }
  const spread = Math.max(30, Math.round((hours * 60) / Math.max(1, openDays.size)));
  if (isWeekend(day) && caps.weekend != null) return caps.weekend;
  if (!isWeekend(day) && caps.weekday != null) return caps.weekday;
  if (caps.any != null) return Math.min(spread, caps.any);
  return spread;
}

function nextWorkingDay(member: CapacityMember, start: Date, caps: SessionCaps): Date {
  let cursor = start;
  for (let i = 0; i < 370 && !isWorkingDay(member, cursor, caps); i += 1) cursor = addDays(cursor, 1);
  return cursor;
}

function orderTitles(tasks: PlanTask[]): { ordered: PlanTask[]; cycle: boolean } {
  const byTitle = new Map(tasks.map((task) => [task.title.toLowerCase(), task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: PlanTask[] = [];
  let cycle = false;
  const visit = (task: PlanTask) => {
    const key = task.title.toLowerCase();
    if (visited.has(key) || cycle) return;
    if (visiting.has(key)) {
      cycle = true;
      return;
    }
    visiting.add(key);
    for (const dependency of task.dependsOnTitles) {
      const parent = byTitle.get(dependency.toLowerCase());
      if (parent) visit(parent);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(task);
  };
  for (const task of tasks) visit(task);
  return { ordered, cycle };
}

function skillScore(member: CapacityMember, task: PlanTask): number {
  const words = member.skills.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const haystack = `${task.title} ${task.description}`.toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

/** Replaces model dates with a capacity-aware schedule and a calculated feasibility result. */
export function schedulePlan(plan: GeneratedPlan, options: ScheduleOptions): GeneratedPlan {
  const start = options.startDate ? parseDay(options.startDate) : null;
  const explicitDeadline = options.deadline ? parseDay(options.deadline) : null;
  const assumptions = plan.assumptions.filter((item) => !/^(Critical path:|The last \d+ day|No deadline was given|Work is balanced|.+ is the owner of new work)/.test(item));
  const risks = [...plan.risks];
  const questions = [...plan.questions];
  const alternatives: string[] = [];
  const fallbackHours = options.weeklyHours && options.weeklyHours > 0 ? options.weeklyHours : 6;
  const caps = statedSessionCaps(options.notes ?? '');

  if (!start || (options.deadline && !explicitDeadline) || (explicitDeadline && explicitDeadline < start)) {
    return {
      ...plan,
      feasible: false,
      criticalPath: [],
      workload: [],
      alternatives: unique(['Set a deadline on or after the start date before treating the dates as a schedule.']),
      risks: unique([...risks, 'The project dates are invalid, so the schedule was not calculated.']),
    };
  }

  const assumedDeadline = !explicitDeadline;
  const deadline = explicitDeadline ?? addDays(start, 28);
  if (assumedDeadline && !questions.some((item) => /deadline/i.test(item))) {
    questions.push('When does this need to be finished? Dates use a four-week window until you set one.');
  }
  if (assumedDeadline) assumptions.push('No deadline was given, so capacity is checked against four weeks.');

  const span = Math.max(1, daySpan(start, deadline));
  const bufferDays = !explicitDeadline && span >= 10 ? Math.max(1, Math.floor(span * 0.15)) : !explicitDeadline && span >= 5 ? 1 : 0;
  const scheduleEnd = bufferDays ? addDays(deadline, -bufferDays) : deadline;
  const horizon = scheduleEnd < start ? deadline : scheduleEnd;
  if (bufferDays) assumptions.push(`The last ${bufferDays} day${bufferDays === 1 ? '' : 's'} before the deadline are held for testing and revisions.`);

  const members = options.members.map((member) => ({
    ...member,
    weeklyHours: member.weeklyHours > 0 ? member.weeklyHours : fallbackHours,
    skills: member.skills || '',
    availableWeekdays: member.availableWeekdays || [],
    unavailable: member.unavailable || [],
  }));
  if (members.length === 1) assumptions.push(`${members[0]?.name || 'The only member'} is the owner of new work because nobody else is on the project.`);
  else if (members.length > 1 && members.every((member) => !member.skills.trim())) {
    assumptions.push('Work is balanced by remaining hours because no skill differences were recorded.');
  }
  if (!members.length) {
    questions.push('Who can do this work? No team members were available, so tasks stay unassigned.');
  }

  const used = new Map<string, Map<string, number>>();
  const assignedMinutes = new Map<string, number>();
  for (const member of members) {
    used.set(member.id, new Map());
    assignedMinutes.set(member.id, 0);
  }

  const dayCapacity = (member: CapacityMember, from: Date, to: Date) => {
    let total = 0;
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      if (isWorkingDay(member, cursor, caps)) total += budgetFor(member, cursor, fallbackHours, caps);
    }
    return total;
  };

  const occupy = (member: CapacityMember, earliest: Date, minutes: number, fraction = 1) => {
    const book = used.get(member.id) ?? new Map<string, number>();
    used.set(member.id, book);
    let remaining = Math.max(15, minutes);
    let cursor = nextWorkingDay(member, earliest, caps);
    let first: Date | null = null;
    let last = cursor;
    const limit = addDays(cursor, 800);
    while (remaining > 0 && cursor <= limit) {
      if (isWorkingDay(member, cursor, caps)) {
        const key = formatDay(cursor);
        const full = budgetFor(member, cursor, fallbackHours, caps);
        const paced = fraction >= 1 ? full : Math.max(15, Math.min(full, Math.round(full * fraction)));
        const room = paced - (book.get(key) ?? 0);
        if (room > 0) {
          const take = Math.min(room, remaining);
          book.set(key, (book.get(key) ?? 0) + take);
          if (!first) first = new Date(cursor);
          last = new Date(cursor);
          remaining -= take;
        }
      }
      if (remaining > 0) cursor = addDays(cursor, 1);
    }
    assignedMinutes.set(member.id, (assignedMinutes.get(member.id) ?? 0) + (minutes - remaining));
    return { start: first ?? earliest, end: last, unfinished: remaining > 0 };
  };

  for (const existing of options.existingTasks ?? []) {
    if (existing.status === 'completed') continue;
    const minutes = existing.estimatedMinutes && existing.estimatedMinutes > 0 ? existing.estimatedMinutes : 60;
    const owner = members.find((member) => member.id === existing.assigneeId);
    if (owner) occupy(owner, start, minutes);
    if (existing.dueDate && existing.dueDate < formatDay(start)) {
      risks.push(`“${existing.title}” is already overdue and still open. New work that depends on it starts after ${formatDay(start)}.`);
    }
  }

  const { ordered, cycle } = orderTitles(plan.tasks.filter((task) => !task.alreadyTracked));
  const kept = plan.tasks.filter((task) => task.alreadyTracked);
  if (cycle) {
    return {
      ...plan,
      feasible: false,
      criticalPath: [],
      workload: [],
      alternatives: unique(['Remove the dependency loop, then calculate the schedule again.']),
      risks: unique([...risks, 'The tasks depend on each other in a loop, so dates were not rewritten.']),
      questions: unique(questions),
      assumptions: unique(assumptions),
    };
  }

  const dueByTitle = new Map<string, string>();
  for (const task of kept) dueByTitle.set(task.title.toLowerCase(), task.dueDate);
  const newMinutes = ordered.reduce((sum, task) => sum + (task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 90), 0);
  const widest = members.reduce((best, member) => Math.max(best, dayCapacity(member, start, horizon)), 0);
  const fraction = widest > 0 ? Math.min(1, newMinutes / widest) : 1;
  const scheduled: PlanTask[] = [];
  const anySkills = members.some((member) => member.skills.trim().length > 0);
  let vague = 0;
  let spilled = false;
  let pastDeadline = false;

  for (const task of ordered) {
    const minutes = task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 90;
    let earliest = start;
    for (const dependency of task.dependsOnTitles) {
      const due = dueByTitle.get(dependency.toLowerCase());
      const dueDay = due ? parseDay(due) : null;
      if (dueDay && dueDay > earliest) earliest = dueDay;
    }
    const ranked = [...members].sort((a, b) => {
      const skill = skillScore(b, task) - skillScore(a, task);
      if (anySkills && skill !== 0) return skill;
      return (assignedMinutes.get(a.id) ?? 0) - (assignedMinutes.get(b.id) ?? 0);
    });
    const owner = ranked[0];
    if (!owner) {
      scheduled.push({ ...task, estimatedMinutes: minutes, assigneeId: null, assigneeName: 'Unassigned' });
      dueByTitle.set(task.title.toLowerCase(), task.dueDate);
      continue;
    }
    const placed = occupy(owner, earliest, minutes, fraction);
    const endKey = formatDay(placed.end);
    if (endKey > formatDay(horizon)) spilled = true;
    if (endKey > formatDay(deadline)) pastDeadline = true;
    dueByTitle.set(task.title.toLowerCase(), endKey);
    scheduled.push({
      ...task,
      estimatedMinutes: minutes,
      assigneeId: owner.id,
      assigneeName: owner.name,
      startDate: formatDay(placed.start),
      dueDate: endKey,
    });
    if (!/done when/i.test(task.description) && task.microGoals.length === 0) vague += 1;
    if (placed.unfinished) pastDeadline = true;
  }

  const tasks = [...kept, ...scheduled];
  const effort = new Map<string, number>();
  for (const task of tasks) effort.set(task.title.toLowerCase(), task.estimatedMinutes ?? 90);
  const memo = new Map<string, { minutes: number; path: string[] }>();
  const longest = (title: string, trail: Set<string>): { minutes: number; path: string[] } => {
    const key = title.toLowerCase();
    const cached = memo.get(key);
    if (cached) return cached;
    if (trail.has(key)) return { minutes: 0, path: [] };
    trail.add(key);
    const task = tasks.find((item) => item.title.toLowerCase() === key);
    let best = { minutes: effort.get(key) ?? 0, path: [task?.title ?? title] };
    for (const dependency of task?.dependsOnTitles ?? []) {
      const parent = longest(dependency, trail);
      const minutes = parent.minutes + (effort.get(key) ?? 0);
      if (minutes > best.minutes) best = { minutes, path: [...parent.path, task?.title ?? title] };
    }
    trail.delete(key);
    memo.set(key, best);
    return best;
  };
  let critical = { minutes: 0, path: [] as string[] };
  for (const task of tasks) {
    const path = longest(task.title, new Set());
    if (path.minutes > critical.minutes) critical = path;
  }

  const capacityMinutes = (member: CapacityMember) => {
    let total = 0;
    for (let cursor = start; cursor <= deadline; cursor = addDays(cursor, 1)) {
      if (isWorkingDay(member, cursor, caps)) total += budgetFor(member, cursor, fallbackHours, caps);
    }
    return total;
  };
  const workload = members.map((member) => ({
    name: member.name,
    minutes: assignedMinutes.get(member.id) ?? 0,
    capacityMinutes: capacityMinutes(member),
  }));
  const overloaded = workload.filter((item) => item.capacityMinutes > 0 && item.minutes > item.capacityMinutes);
  if (overloaded.length) {
    risks.push(`${overloaded.map((item) => item.name).join(', ')} ${overloaded.length === 1 ? 'has' : 'have'} more estimated work than the available hours.`);
  }
  const loads = workload.map((item) => item.minutes).filter((minutes) => minutes > 0);
  if (loads.length > 1 && Math.max(...loads) > Math.min(...loads) * 1.5 && Math.max(...loads) - Math.min(...loads) > 120) {
    risks.push('The estimated hours are uneven across the people who have work.');
  }
  const milestones = !explicitDeadline ? plan.milestones : plan.milestones.map((milestone, index, list) => {
    const slot = Math.round((span * (index + 1)) / Math.max(1, list.length));
    return { ...milestone, dueDate: formatDay(addDays(start, Math.min(span, Math.max(0, slot)))) };
  });
  for (const milestone of milestones) {
    const latest = scheduled.reduce((end, task) => (task.dueDate > end ? task.dueDate : end), formatDay(start));
    if (milestone.dueDate < latest && milestone.dueDate < formatDay(deadline)) {
      risks.push(`“${milestone.title}” is dated ${milestone.dueDate}, before later work finishes on ${latest}.`);
    }
  }
  if (vague) risks.push(`${vague} task${vague === 1 ? '' : 's'} do not say how to tell they are finished.`);
  if (critical.path.length > 1 && critical.path.length <= 4) {
    assumptions.push(`Critical path: ${critical.path.join(' → ')}.`);
  }
  const feasible = !cycle && !spilled && !pastDeadline && overloaded.length === 0 && scheduled.length > 0;
  if (!feasible) {
    const end = scheduled.reduce((last, task) => (task.dueDate > last ? task.dueDate : last), formatDay(deadline));
    if (pastDeadline || spilled) {
      const overflow = workload.reduce((sum, item) => sum + Math.max(0, item.minutes - item.capacityMinutes), 0) / 60;
      const cut = overflow >= 1 ? `, or cut about ${hoursLabel(overflow)} of work` : '';
      alternatives.push(`Move the deadline to ${end}${cut}.`);
    }
    if (overloaded.length) alternatives.push('Add weekly hours for the overloaded people, or move some of their tasks to someone with open time.');
    if (!scheduled.length) alternatives.push('Add at least one new task before calculating a schedule.');
    risks.push('This plan does not fit the deadline and the hours the team actually has. The dates shown are the calculated schedule, not a promise that it fits.');
  }

  return {
    ...plan,
    feasible,
    assumptions: unique(assumptions),
    risks: unique(risks),
    questions: unique(questions),
    alternatives: unique(alternatives),
    criticalPath: critical.path,
    workload,
    tasks,
    milestones,
  };
}
