import { parseDay } from './dates';
import type { GeneratedPlan, PlanMeeting, PlanPriority, PlanTask } from './types';

export interface PlanBounds {
  startDate: string | null;
  deadline: string | null;
}

export interface DraftTask {
  id: string;
  title: string;
  description: string;
  phaseId: string;
  priority: PlanPriority;
  estimatedMinutes: number | null;
  startDate: string;
  dueDate: string;
  dependsOn: string[];
  microGoals: string[];
  alreadyTracked: boolean;
  assigneeId: string | null;
  assigneeName: string;
}

export interface DraftPhase {
  id: string;
  name: string;
  summary: string;
}

export interface DraftMilestone {
  id: string;
  title: string;
  dueDate: string;
}

export interface PlanDraft {
  summary: string;
  feasible: boolean;
  assumptions: string[];
  risks: string[];
  questions: string[];
  phases: DraftPhase[];
  milestones: DraftMilestone[];
  tasks: DraftTask[];
  meetings: PlanMeeting[];
  source: GeneratedPlan['source'];
  notices: string[];
  criticalPath: string[];
  workload: { name: string; minutes: number; capacityMinutes: number }[];
  alternatives: string[];
}

export interface DraftCheck {
  tasks: PlanTask[];
  milestones: { title: string; dueDate: string }[];
}

function nextId(prefix: string, ids: string[]): string {
  let number = ids.length + 1;
  let id = `${prefix}-${number}`;
  while (ids.includes(id)) {
    number += 1;
    id = `${prefix}-${number}`;
  }
  return id;
}

function cycle(tasks: DraftTask[]): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): boolean => {
    const mark = state.get(id) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(id, 1);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (visit(dependency)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return tasks.some((task) => visit(task.id));
}

export function planFromDraft(draft: PlanDraft, base: GeneratedPlan): GeneratedPlan {
  const checked = validateDraft(draft, { startDate: null, deadline: null });
  if (!checked.ok) throw new Error(checked.error);
  return {
    ...base,
    summary: draft.summary,
    feasible: draft.feasible,
    assumptions: draft.assumptions,
    risks: draft.risks,
    questions: draft.questions,
    phases: draft.phases.map((phase) => ({ name: phase.name.trim(), summary: phase.summary })),
    milestones: checked.value.milestones,
    tasks: checked.value.tasks,
    meetings: draft.meetings,
    source: draft.source,
    notices: draft.notices,
    criticalPath: draft.criticalPath,
    workload: draft.workload,
    alternatives: draft.alternatives,
  };
}

export function draftFromPlan(plan: GeneratedPlan): PlanDraft {
  const phases: DraftPhase[] = plan.phases.map((phase, index) => ({
    id: `phase-${index + 1}`,
    name: phase.name,
    summary: phase.summary,
  }));
  if (!phases.length) phases.push({ id: 'phase-1', name: 'Build', summary: '' });
  const phaseIdFor = (name: string) => phases.find((phase) => phase.name === name)?.id ?? phases[0].id;
  const tasks: DraftTask[] = plan.tasks.map((task, index) => ({
    id: `task-${index + 1}`,
    title: task.title,
    description: task.description,
    phaseId: phaseIdFor(task.phase),
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    startDate: task.startDate,
    dueDate: task.dueDate,
    dependsOn: [],
    microGoals: [...task.microGoals],
    alreadyTracked: task.alreadyTracked,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,
  }));
  const idByTitle = new Map(tasks.map((task) => [task.title.toLowerCase(), task.id]));
  plan.tasks.forEach((task, index) => {
    const current = tasks[index];
    if (!current) return;
    current.dependsOn = task.dependsOnTitles
      .map((title) => idByTitle.get(title.toLowerCase()))
      .filter((id): id is string => Boolean(id) && id !== current.id);
  });
  return {
    summary: plan.summary,
    feasible: plan.feasible,
    assumptions: [...plan.assumptions],
    risks: [...plan.risks],
    questions: [...plan.questions],
    phases,
    milestones: plan.milestones.map((milestone, index) => ({
      id: `milestone-${index + 1}`,
      title: milestone.title,
      dueDate: milestone.dueDate,
    })),
    tasks,
    meetings: plan.meetings.map((meeting) => ({ ...meeting })),
    criticalPath: plan.criticalPath ?? [],
    workload: plan.workload ?? [],
    alternatives: plan.alternatives ?? [],
    source: plan.source,
    notices: [...plan.notices],
  };
}

export function updateTask(
  draft: PlanDraft,
  taskId: string,
  patch: Partial<Pick<DraftTask, 'title' | 'description' | 'priority' | 'estimatedMinutes' | 'startDate' | 'dueDate' | 'phaseId' | 'microGoals'>>,
): PlanDraft {
  return {
    ...draft,
    tasks: draft.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  };
}

export function addTask(draft: PlanDraft, phaseId: string, dates: { startDate: string; dueDate: string }): PlanDraft {
  const phase = draft.phases.find((item) => item.id === phaseId) ?? draft.phases[0];
  if (!phase) return draft;
  const task: DraftTask = {
    id: nextId('task', draft.tasks.map((item) => item.id)),
    title: 'New task',
    description: '',
    phaseId: phase.id,
    priority: 'medium',
    estimatedMinutes: null,
    startDate: dates.startDate,
    dueDate: dates.dueDate,
    dependsOn: [],
    microGoals: [],
    alreadyTracked: false,
    assigneeId: null,
    assigneeName: 'Unassigned',
  };
  return { ...draft, tasks: [...draft.tasks, task] };
}

export function removeTask(draft: PlanDraft, taskId: string): { draft: PlanDraft; detached: string[] } {
  const detached = draft.tasks.filter((task) => task.dependsOn.includes(taskId)).map((task) => task.title);
  return {
    draft: {
      ...draft,
      tasks: draft.tasks
        .filter((task) => task.id !== taskId)
        .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((id) => id !== taskId) })),
    },
    detached,
  };
}

export function moveTask(draft: PlanDraft, taskId: string, direction: -1 | 1): PlanDraft {
  const task = draft.tasks.find((item) => item.id === taskId);
  if (!task) return draft;
  const indexes = draft.tasks.map((item, index) => (item.phaseId === task.phaseId ? index : -1)).filter((index) => index >= 0);
  const position = indexes.findIndex((index) => draft.tasks[index]?.id === taskId);
  const swapIndex = indexes[position + direction];
  const currentIndex = indexes[position];
  if (swapIndex == null || currentIndex == null) return draft;
  const tasks = draft.tasks.slice();
  const current = tasks[currentIndex];
  const other = tasks[swapIndex];
  if (!current || !other) return draft;
  tasks[currentIndex] = other;
  tasks[swapIndex] = current;
  return { ...draft, tasks };
}

export function moveTaskToPhase(draft: PlanDraft, taskId: string, phaseId: string): PlanDraft {
  if (!draft.phases.some((phase) => phase.id === phaseId)) return draft;
  const task = draft.tasks.find((item) => item.id === taskId);
  if (!task || task.phaseId === phaseId) return draft;
  return {
    ...draft,
    tasks: [...draft.tasks.filter((item) => item.id !== taskId), { ...task, phaseId }],
  };
}

export function updatePhase(
  draft: PlanDraft,
  phaseId: string,
  patch: Partial<Pick<DraftPhase, 'name' | 'summary'>>,
): PlanDraft {
  return {
    ...draft,
    phases: draft.phases.map((phase) => (phase.id === phaseId ? { ...phase, ...patch } : phase)),
  };
}

export function addPhase(draft: PlanDraft): PlanDraft {
  const phase: DraftPhase = {
    id: nextId('phase', draft.phases.map((item) => item.id)),
    name: 'New phase',
    summary: '',
  };
  return { ...draft, phases: [...draft.phases, phase] };
}

export function movePhase(draft: PlanDraft, phaseId: string, direction: -1 | 1): PlanDraft {
  const index = draft.phases.findIndex((phase) => phase.id === phaseId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.phases.length) return draft;
  const phases = draft.phases.slice();
  const [item] = phases.splice(index, 1);
  if (!item) return draft;
  phases.splice(target, 0, item);
  return { ...draft, phases };
}

export function removePhase(draft: PlanDraft, phaseId: string): { draft: PlanDraft; error: string } {
  if (draft.phases.length <= 1) return { draft, error: 'Keep at least one phase.' };
  if (draft.tasks.some((task) => task.phaseId === phaseId)) {
    return { draft, error: 'Move or remove this phase’s tasks first.' };
  }
  return { draft: { ...draft, phases: draft.phases.filter((phase) => phase.id !== phaseId) }, error: '' };
}

export function updateMilestone(
  draft: PlanDraft,
  milestoneId: string,
  patch: Partial<Pick<DraftMilestone, 'title' | 'dueDate'>>,
): PlanDraft {
  return {
    ...draft,
    milestones: draft.milestones.map((milestone) => (milestone.id === milestoneId ? { ...milestone, ...patch } : milestone)),
  };
}

export function addMilestone(draft: PlanDraft, dueDate: string): PlanDraft {
  return {
    ...draft,
    milestones: [
      ...draft.milestones,
      { id: nextId('milestone', draft.milestones.map((item) => item.id)), title: 'New milestone', dueDate },
    ],
  };
}

export function removeMilestone(draft: PlanDraft, milestoneId: string): PlanDraft {
  return { ...draft, milestones: draft.milestones.filter((milestone) => milestone.id !== milestoneId) };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function validateApprovedTasks(tasks: PlanTask[], bounds: PlanBounds): { ok: true; value: PlanTask[] } | { ok: false; error: string } {
  if (!tasks.length) return fail('Add at least one task before saving.');
  if (tasks.length > 40) return fail('A plan can include at most 40 tasks.');
  const titles = new Set<string>();
  for (const task of tasks) {
    const title = task.title.trim();
    if (!title || title.length > 160) return fail('Each task needs a title of 160 characters or fewer.');
    const key = title.toLowerCase();
    if (titles.has(key)) return fail(`“${title}” is listed more than once.`);
    titles.add(key);
    if (task.description.length > 8000) return fail(`“${title}” has a description that is too long.`);
    if (task.estimatedMinutes != null && (task.estimatedMinutes < 15 || task.estimatedMinutes > 480)) {
      return fail(`“${title}” needs a duration between 15 and 480 minutes, or none.`);
    }
    const start = parseDay(task.startDate);
    const due = parseDay(task.dueDate);
    if (!start || !due) return fail(`“${title}” has an invalid date.`);
    if (due < start) return fail(`“${title}” ends before it starts.`);
    const projectStart = bounds.startDate ? parseDay(bounds.startDate) : null;
    const projectEnd = bounds.deadline ? parseDay(bounds.deadline) : null;
    if (bounds.startDate && !projectStart) return fail('The project start date is invalid.');
    if (bounds.deadline && !projectEnd) return fail('The project deadline is invalid.');
    if (projectStart && start < projectStart) return fail(`“${title}” starts before the project.`);
    if (projectEnd && due > projectEnd) return fail(`“${title}” is due after the project deadline.`);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOnTitles) {
      if (!titles.has(dependency.trim().toLowerCase())) {
        return fail(`“${task.title}” depends on “${dependency}”, which is not in the plan.`);
      }
      if (dependency.trim().toLowerCase() === task.title.trim().toLowerCase()) {
        return fail(`“${task.title}” cannot depend on itself.`);
      }
    }
  }
  const state = new Map<string, 0 | 1 | 2>();
  const byTitle = new Map(tasks.map((task) => [task.title.trim().toLowerCase(), task]));
  const visit = (title: string): boolean => {
    const key = title.trim().toLowerCase();
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
  if (tasks.some((task) => visit(task.title))) return fail('The plan has a circular dependency.');
  return { ok: true, value: tasks };
}

export function validateDraft(draft: PlanDraft, bounds: PlanBounds): { ok: true; value: DraftCheck } | { ok: false; error: string } {
  if (!draft.phases.length || draft.phases.length > 8) return fail('Use between 1 and 8 phases.');
  const phaseNames = new Set<string>();
  for (const phase of draft.phases) {
    const name = phase.name.trim();
    if (!name || name.length > 80) return fail('Each phase needs a name of 80 characters or fewer.');
    if (phaseNames.has(name.toLowerCase())) return fail(`The phase “${name}” is listed more than once.`);
    phaseNames.add(name.toLowerCase());
  }
  if (cycle(draft.tasks)) return fail('The plan has a circular dependency.');
  const ids = new Set(draft.tasks.map((task) => task.id));
  if (ids.size !== draft.tasks.length) return fail('Task identifiers must be unique.');
  const phaseById = new Map(draft.phases.map((phase) => [phase.id, phase.name.trim()]));
  const titleById = new Map(draft.tasks.map((task) => [task.id, task.title.trim()]));
  const tasks: PlanTask[] = [];
  for (const task of draft.tasks) {
    const phase = phaseById.get(task.phaseId);
    if (!phase) return fail(`“${task.title || 'A task'}” is not in a phase.`);
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) return fail(`“${task.title}” depends on a task that was removed.`);
    }
    tasks.push({
      title: task.title.trim(),
      description: task.description.trim(),
      phase,
      assigneeId: task.assigneeId,
      assigneeName: task.assigneeName,
      priority: task.priority,
      estimatedMinutes: task.estimatedMinutes,
      startDate: task.startDate,
      dueDate: task.dueDate,
      dependsOnTitles: task.dependsOn.map((id) => titleById.get(id) || '').filter(Boolean),
      microGoals: task.microGoals.map((item) => item.trim()).filter(Boolean).slice(0, 6),
      alreadyTracked: task.alreadyTracked,
    });
  }
  const approved = validateApprovedTasks(tasks, bounds);
  if (!approved.ok) return approved;
  if (draft.milestones.length > 12) return fail('A plan can include at most 12 milestones.');
  const milestoneTitles = new Set<string>();
  const milestones: { title: string; dueDate: string }[] = [];
  for (const milestone of draft.milestones) {
    const title = milestone.title.trim();
    if (!title || title.length > 140) return fail('Each milestone needs a title of 140 characters or fewer.');
    if (milestoneTitles.has(title.toLowerCase())) return fail(`The milestone “${title}” is listed more than once.`);
    milestoneTitles.add(title.toLowerCase());
    const due = parseDay(milestone.dueDate);
    if (!due) return fail(`The milestone “${title}” has an invalid date.`);
    const projectStart = bounds.startDate ? parseDay(bounds.startDate) : null;
    const projectEnd = bounds.deadline ? parseDay(bounds.deadline) : null;
    if (projectStart && due < projectStart) return fail(`“${title}” is dated before the project starts.`);
    if (projectEnd && due > projectEnd) return fail(`“${title}” is dated after the project deadline.`);
    milestones.push({ title, dueDate: milestone.dueDate.slice(0, 10) });
  }
  return { ok: true, value: { tasks: approved.value, milestones } };
}
