export interface ExistingPlanTask {
  title: string;
  status: string;
}

export interface ProposedPlanTask {
  title: string;
  alreadyTracked?: boolean;
}

export interface PlanPartition<T extends ProposedPlanTask> {
  save: T[];
  skipped: string[];
  preserved: string[];
}

/** Completed titles are kept. Matching open titles are not written again. Nothing is deleted. */
export function partitionPlanTasks<T extends ProposedPlanTask>(
  existing: ExistingPlanTask[],
  tasks: T[],
): PlanPartition<T> {
  const completed = new Set(
    existing.filter((task) => task.status === 'completed').map((task) => task.title.trim().toLowerCase()),
  );
  const titles = new Set(existing.map((task) => task.title.trim().toLowerCase()));
  const save: T[] = [];
  const skipped: string[] = [];
  const preserved: string[] = [];
  for (const task of tasks) {
    const key = task.title.trim().toLowerCase();
    if (completed.has(key)) {
      preserved.push(task.title);
      continue;
    }
    if (titles.has(key)) {
      skipped.push(task.title);
      continue;
    }
    save.push(task);
    titles.add(key);
  }
  return { save, skipped, preserved };
}

export function describePlanChanges(
  existing: ExistingPlanTask[],
  tasks: ProposedPlanTask[],
): { add: string[]; skip: string[]; preserve: string[] } {
  const partitioned = partitionPlanTasks(existing, tasks);
  return {
    add: partitioned.save.map((task) => task.title),
    skip: partitioned.skipped,
    preserve: partitioned.preserved,
  };
}

/** Creating a project happens once. A later confirm only saves tasks onto that id. */
export function nextPersistenceStep(
  mode: 'new' | 'revise',
  existingProjectId: string | null,
): 'create' | 'save' | 'blocked' {
  if (mode === 'revise') return existingProjectId ? 'save' : 'blocked';
  return existingProjectId ? 'save' : 'create';
}
