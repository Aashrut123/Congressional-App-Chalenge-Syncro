import { daySpan, parseDay } from './dates.ts';
import { knownProjectType } from './presets.ts';
import type { GeneratedPlan, PlanPriority, PlannerInput, PlanTask } from './types.ts';

const priorities: PlanPriority[] = ['low', 'medium', 'high'];

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationErr {
  ok: false;
  error: string;
}

export type Validation<T> = ValidationOk<T> | ValidationErr;

function dependencyCycle(tasks: { title: string; dependsOnTitles: string[] }[]): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  const byTitle = new Map(tasks.map((task) => [task.title.toLowerCase(), task]));
  const visit = (title: string): boolean => {
    const key = title.toLowerCase();
    const mark = state.get(key) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(key, 1);
    for (const dependency of byTitle.get(key)?.dependsOnTitles ?? []) {
      if (visit(dependency)) return true;
    }
    state.set(key, 2);
    return false;
  };
  return tasks.some((task) => visit(task.title));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PlanRequest {
  operation: 'new' | 'revise';
  groupId: string | null;
  title: string;
  outcome: string;
  startDate: string | null;
  deadline: string | null;
  notes: string;
  members: {
    id: string;
    name: string;
    weeklyHours: number | null;
    availableWeekdays: number[];
    unavailable: { start: string; end: string }[];
    skills: string;
  }[];
  weeklyHours: number | null;
  existingTasks: { title: string; status: string; estimatedMinutes: number | null; dueDate: string | null; assigneeId: string | null }[];
  projectType: string;
  revision: string;
  milestones: { title: string; date: string | null }[];
}

/** Fields the planner is allowed to send to the model. Extra payload keys are ignored. */
export function validatePlanRequest(value: unknown): Validation<PlanRequest> {
  const record = asRecord(value);
  if (!record) return { ok: false, error: 'The plan request was not an object.' };
  const title = text(record.title, 120);
  if (!title) return { ok: false, error: 'Add a project name (120 characters or fewer).' };
  const outcome = text(record.outcome, 2000) ?? text(record.description, 2000);
  if (!outcome) return { ok: false, error: 'Describe the project goal (2000 characters or fewer).' };
  const startDate = typeof record.startDate === 'string' && record.startDate.trim() ? record.startDate.slice(0, 10) : null;
  const deadline = typeof record.deadline === 'string' && record.deadline.trim() ? record.deadline.slice(0, 10) : null;
  if (startDate && !parseDay(startDate)) return { ok: false, error: 'Enter a valid start date (YYYY-MM-DD).' };
  if (deadline && !parseDay(deadline)) return { ok: false, error: 'Enter a valid deadline (YYYY-MM-DD).' };
  if (startDate && deadline && (parseDay(deadline) as Date) < (parseDay(startDate) as Date)) {
    return { ok: false, error: 'The deadline has to be on or after the start date.' };
  }
  if (startDate && deadline && daySpan(parseDay(startDate) as Date, parseDay(deadline) as Date) > 366) {
    return { ok: false, error: 'Plans are limited to one year so the schedule stays realistic.' };
  }
  const notesSource = typeof record.notes === 'string' ? record.notes : typeof record.constraints === 'string' ? record.constraints : '';
  const notes = notesSource.trim().slice(0, 2000);
  let groupId: string | null = null;
  if (typeof record.groupId === 'string' && record.groupId.trim()) {
    if (!uuidPattern.test(record.groupId.trim())) return { ok: false, error: 'The project id is not valid.' };
    groupId = record.groupId.trim();
  }
  if (record.members != null && !Array.isArray(record.members)) {
    return { ok: false, error: 'Team members must be a list.' };
  }
  if (Array.isArray(record.members) && record.members.length > 30) {
    return { ok: false, error: 'A plan can include at most 30 teammates.' };
  }
  const members: PlanRequest['members'] = [];
  for (const item of Array.isArray(record.members) ? record.members : []) {
    const member = asRecord(item);
    const id = member ? text(member.id, 80) : null;
    const name = member ? text(member.name, 80) : null;
    if (!id || !name) return { ok: false, error: 'Every teammate needs an id and a name.' };
    const memberHours = member && typeof member.weeklyHours === 'number' && member.weeklyHours >= 1 && member.weeklyHours <= 40
      ? Math.round(member.weeklyHours)
      : null;
    const availableWeekdays = Array.isArray(member?.availableWeekdays)
      ? member.availableWeekdays.filter((day): day is number => typeof day === 'number' && day >= 0 && day <= 6).slice(0, 7)
      : [];
    const unavailable = Array.isArray(member?.unavailable)
      ? member.unavailable.flatMap((range) => {
        const row = asRecord(range);
        const rangeStart = row && typeof row.start === 'string' ? row.start.slice(0, 10) : '';
        const rangeEnd = row && typeof row.end === 'string' ? row.end.slice(0, 10) : '';
        if (!parseDay(rangeStart) || !parseDay(rangeEnd)) return [];
        return [{ start: rangeStart, end: rangeEnd }];
      }).slice(0, 12)
      : [];
    const skills = member && typeof member.skills === 'string' ? member.skills.trim().slice(0, 400) : '';
    members.push({ id, name, weeklyHours: memberHours, availableWeekdays, unavailable, skills });
  }
  const hoursSource = record.weeklyHoursDefault ?? record.weeklyHours;
  let weeklyHours: number | null = null;
  if (hoursSource != null && hoursSource !== '') {
    const hours = Number(hoursSource);
    if (!Number.isFinite(hours) || hours < 1 || hours > 40) {
      return { ok: false, error: 'Weekly hours must be between 1 and 40.' };
    }
    weeklyHours = Math.round(hours);
  }
  if (record.existingTasks != null && !Array.isArray(record.existingTasks)) {
    return { ok: false, error: 'Existing tasks must be a list.' };
  }
  if (Array.isArray(record.existingTasks) && record.existingTasks.length > 40) {
    return { ok: false, error: 'Too many existing tasks were included.' };
  }
  const existingTasks: PlanRequest['existingTasks'] = [];
  for (const item of Array.isArray(record.existingTasks) ? record.existingTasks : []) {
    const task = asRecord(item);
    const taskTitle = task ? text(task.title, 160) : null;
    const status = task && typeof task.status === 'string' ? task.status.trim().slice(0, 40) : '';
    if (!taskTitle || !status) return { ok: false, error: 'Each existing task needs a title and a status.' };
    const estimatedMinutes = task && typeof task.estimatedMinutes === 'number' && task.estimatedMinutes > 0 && task.estimatedMinutes <= 480
      ? Math.round(task.estimatedMinutes)
      : null;
    const dueDate = task && typeof task.dueDate === 'string' && parseDay(task.dueDate) ? task.dueDate.slice(0, 10) : null;
    const assigneeId = task ? text(task.assigneeId, 80) : null;
    existingTasks.push({ title: taskTitle, status, estimatedMinutes, dueDate, assigneeId });
  }
  let operation: 'new' | 'revise' = groupId ? 'revise' : 'new';
  if (record.operation === 'new' || record.operation === 'revise') operation = record.operation;
  else if (record.operation != null && record.operation !== '') {
    return { ok: false, error: 'The planning operation is not valid.' };
  }
  if (operation === 'new' && groupId) {
    return { ok: false, error: 'A new project draft cannot target an existing project.' };
  }
  if (operation === 'revise' && !groupId) {
    return { ok: false, error: 'Choose a project before revising its plan.' };
  }
  const projectType = knownProjectType(record.projectType);
  const revision = typeof record.revision === 'string' ? record.revision.trim().slice(0, 1000) : '';
  if (record.milestones != null && !Array.isArray(record.milestones)) {
    return { ok: false, error: 'Milestones must be a list.' };
  }
  if (Array.isArray(record.milestones) && record.milestones.length > 12) {
    return { ok: false, error: 'A plan can include at most 12 milestones.' };
  }
  const milestones: { title: string; date: string | null }[] = [];
  for (const item of Array.isArray(record.milestones) ? record.milestones : []) {
    const milestone = asRecord(item);
    const milestoneTitle = milestone ? text(milestone.title, 140) : null;
    if (!milestoneTitle) return { ok: false, error: 'Each milestone needs a title.' };
    const date = milestone && typeof milestone.date === 'string' && milestone.date.trim() ? milestone.date.slice(0, 10) : null;
    if (date && !parseDay(date)) return { ok: false, error: `The milestone “${milestoneTitle}” has an invalid date.` };
    milestones.push({ title: milestoneTitle, date });
  }
  return {
    ok: true,
    value: {
      operation,
      groupId,
      title,
      outcome,
      startDate,
      deadline,
      notes,
      members,
      weeklyHours,
      existingTasks,
      projectType,
      revision,
      milestones,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function validatePlannerInput(input: PlannerInput): Validation<PlannerInput> {
  const title = text(input.title, 120);
  if (!title) return { ok: false, error: 'Add a project title (120 characters or fewer).' };
  const outcome = text(input.outcome, 2000);
  if (!outcome) return { ok: false, error: 'Describe the outcome you want the team to reach.' };
  const start = parseDay(input.startDate);
  if (!start) return { ok: false, error: 'Enter a valid start date (YYYY-MM-DD).' };
  const deadlineText = input.deadline.trim();
  const deadline = deadlineText ? parseDay(deadlineText) : null;
  if (deadlineText && !deadline) return { ok: false, error: 'Enter a valid deadline (YYYY-MM-DD).' };
  if (deadline && deadline < start) return { ok: false, error: 'The deadline has to be on or after the start date.' };
  if (deadline && daySpan(start, deadline) > 366) {
    return { ok: false, error: 'Plans are limited to one year so the schedule stays realistic.' };
  }
  const operation = input.operation === 'revise' ? 'revise' : 'new';
  const groupId = input.groupId?.trim() || null;
  if (operation === 'revise' && (!groupId || !uuidPattern.test(groupId))) {
    return { ok: false, error: 'Choose a project before revising its plan.' };
  }
  if (operation === 'new' && groupId) {
    return { ok: false, error: 'A new project draft cannot target an existing project.' };
  }
  if (!priorities.includes(input.priority)) {
    return { ok: false, error: 'Choose a low, medium, or high priority.' };
  }
  if (!Number.isFinite(input.weeklyHoursDefault) || input.weeklyHoursDefault < 1 || input.weeklyHoursDefault > 40) {
    return { ok: false, error: 'Default weekly hours must be between 1 and 40.' };
  }
  if (!input.members.length) return { ok: false, error: 'Add at least one teammate, including yourself.' };
  for (const member of input.members) {
    if (!text(member.id, 80) || !text(member.name, 80)) {
      return { ok: false, error: 'Every teammate needs a name.' };
    }
    if (!Number.isFinite(member.weeklyHours) || member.weeklyHours < 1 || member.weeklyHours > 40) {
      return { ok: false, error: `${member.name} needs weekly hours between 1 and 40.` };
    }
    for (const block of member.unavailable) {
      const blockStart = parseDay(block.start);
      const blockEnd = parseDay(block.end);
      if (!blockStart || !blockEnd || blockEnd < blockStart) {
        return { ok: false, error: `Unavailable dates for ${member.name} are invalid.` };
      }
    }
  }
  if (input.notes.length > 2000) {
    return { ok: false, error: 'Notes must be 2000 characters or fewer.' };
  }
  return {
    ok: true,
    value: {
      ...input,
      title,
      outcome,
      operation,
      groupId,
      projectType: knownProjectType(input.projectType),
      revision: (input.revision ?? '').trim().slice(0, 1000),
      startDate: input.startDate.slice(0, 10),
      deadline: deadline ? deadlineText.slice(0, 10) : '',
      notes: input.notes.trim(),
      milestones: input.milestones
        .map((item) => ({ title: item.title.trim(), date: item.date?.slice(0, 10) }))
        .filter((item) => item.title.length > 0 && item.title.length <= 140),
    },
  };
}

function parseTask(value: unknown, members: { id: string; name: string }[]): Validation<PlanTask> {
  const record = asRecord(value);
  if (!record) return { ok: false, error: 'A task in the plan was not an object.' };
  const title = text(record.title, 160);
  if (!title) return { ok: false, error: 'A generated task is missing a title.' };
  const description = typeof record.description === 'string' ? record.description.trim().slice(0, 2000) : '';
  const phase = text(record.phase, 80) ?? 'Build';
  const priority = priorities.includes(record.priority as PlanPriority)
    ? (record.priority as PlanPriority)
    : 'medium';
  let estimatedMinutes: number | null = null;
  if (record.estimatedMinutes != null && record.estimatedMinutes !== '') {
    const estimated = Number(record.estimatedMinutes);
    if (!Number.isFinite(estimated) || estimated < 15 || estimated > 480) {
      return { ok: false, error: `Task “${title}” has an unrealistic duration.` };
    }
    estimatedMinutes = Math.round(estimated);
  }
  const startDate = typeof record.startDate === 'string' ? record.startDate.slice(0, 10) : '';
  const dueDate = typeof record.dueDate === 'string' ? record.dueDate.slice(0, 10) : '';
  if (!parseDay(startDate) || !parseDay(dueDate)) {
    return { ok: false, error: `Task “${title}” has an invalid date.` };
  }
  if ((parseDay(dueDate) as Date) < (parseDay(startDate) as Date)) {
    return { ok: false, error: `Task “${title}” ends before it starts.` };
  }
  let assigneeId: string | null = null;
  let assigneeName = 'Unassigned';
  if (typeof record.assigneeId === 'string' && record.assigneeId) {
    const member = members.find((item) => item.id === record.assigneeId);
    if (member) {
      assigneeId = member.id;
      assigneeName = member.name;
    }
  }
  const dependsOnTitles = Array.isArray(record.dependsOnTitles)
    ? record.dependsOnTitles.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
  const microGoals = Array.isArray(record.microGoals)
    ? record.microGoals.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, 180)).slice(0, 6)
    : [];
  return {
    ok: true,
    value: {
      title,
      description,
      phase,
      assigneeId,
      assigneeName,
      priority,
      estimatedMinutes,
      startDate,
      dueDate,
      dependsOnTitles,
      microGoals,
      alreadyTracked: record.alreadyTracked === true,
    },
  };
}

export function parseGeneratedPlan(
  value: unknown,
  members: { id: string; name: string }[],
  bounds?: { startDate?: string | null; deadline?: string | null },
): Validation<GeneratedPlan> {
  const record = asRecord(value);
  if (!record) return { ok: false, error: 'The planner response was not a JSON object.' };
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    return { ok: false, error: 'The planner did not return any tasks.' };
  }
  if (record.tasks.length > 40) return { ok: false, error: 'The planner returned too many tasks.' };
  const tasks: PlanTask[] = [];
  for (const item of record.tasks) {
    const parsed = parseTask(item, members);
    if (!parsed.ok) return parsed;
    tasks.push(parsed.value);
  }
  const titles = new Set(tasks.map((task) => task.title.toLowerCase()));
  if (titles.size !== tasks.length) return { ok: false, error: 'The planner returned duplicate task titles.' };
  for (const task of tasks) {
    for (const dependency of task.dependsOnTitles) {
      if (!titles.has(dependency.toLowerCase())) {
        return { ok: false, error: `Task “${task.title}” depends on “${dependency}”, which is not in the plan.` };
      }
      if (dependency.toLowerCase() === task.title.toLowerCase()) {
        return { ok: false, error: `Task “${task.title}” cannot depend on itself.` };
      }
    }
  }
  if (dependencyCycle(tasks)) return { ok: false, error: 'The planner returned a circular dependency.' };
  const projectStart = bounds?.startDate ? parseDay(bounds.startDate) : null;
  const projectEnd = bounds?.deadline ? parseDay(bounds.deadline) : null;
  if (bounds?.startDate && !projectStart) return { ok: false, error: 'The project start date is invalid.' };
  if (bounds?.deadline && !projectEnd) return { ok: false, error: 'The project deadline is invalid.' };
  const phases = Array.isArray(record.phases)
    ? record.phases.flatMap((item) => {
        const phase = asRecord(item);
        const name = phase ? text(phase.name, 80) : null;
        if (!phase || !name) return [];
        return [{ name, summary: typeof phase.summary === 'string' ? phase.summary.slice(0, 400) : '' }];
      })
    : [];
  const milestones = Array.isArray(record.milestones)
    ? record.milestones.flatMap((item) => {
        const milestone = asRecord(item);
        const title = milestone ? text(milestone.title, 140) : null;
        const dueDate = milestone && typeof milestone.dueDate === 'string' ? milestone.dueDate.slice(0, 10) : '';
        if (!title || !parseDay(dueDate)) return [];
        return [{ title, dueDate }];
      })
    : [];
  const meetings = Array.isArray(record.meetings)
    ? record.meetings.flatMap((item) => {
        const meeting = asRecord(item);
        if (!meeting) return [];
        const title = text(meeting.title, 120);
        const startsAt = typeof meeting.startsAt === 'string' ? meeting.startsAt : '';
        const endsAt = typeof meeting.endsAt === 'string' ? meeting.endsAt : '';
        if (!title || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) return [];
        if (Date.parse(endsAt) <= Date.parse(startsAt)) return [];
        return [{
          title,
          agenda: typeof meeting.agenda === 'string' ? meeting.agenda.slice(0, 1000) : '',
          startsAt,
          endsAt,
          reason: typeof meeting.reason === 'string' ? meeting.reason.slice(0, 300) : '',
        }];
      })
    : [];
  const summary = typeof record.summary === 'string' ? record.summary.trim().slice(0, 800) : '';
  if (!summary) return { ok: false, error: 'The planner did not return a summary.' };
  if (!phases.length) {
    const seen = new Set<string>();
    for (const task of tasks) {
      if (seen.has(task.phase)) continue;
      seen.add(task.phase);
      phases.push({ name: task.phase, summary: '' });
    }
  }
  const list = (key: string) =>
    Array.isArray(record[key])
      ? record[key].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, 400)).slice(0, 12)
      : [];
  return {
    ok: true,
    value: {
      source: 'ai',
      notices: [],
      feasible: record.feasible !== false,
      summary,
      assumptions: list('assumptions'),
      risks: list('risks'),
      questions: list('questions'),
      phases,
      milestones,
      tasks,
      meetings,
      criticalPath: [],
      workload: [],
      alternatives: [],
    },
  };
}
