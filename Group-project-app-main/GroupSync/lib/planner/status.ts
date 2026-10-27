import type { WorkflowStatus } from './types';

const order: WorkflowStatus[] = ['todo', 'in_progress', 'blocked', 'completed'];

export function nextTaskStatus(current: WorkflowStatus): WorkflowStatus {
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? 'todo';
}

export function isOpenStatus(status: string): boolean {
  return status !== 'completed';
}

export function taskStatusLabel(status: string): string {
  if (status === 'completed') return 'Finished';
  if (status === 'in_progress') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  return 'Not started';
}

export function completionPercent(tasks: { status: string }[]): number {
  if (!tasks.length) return 0;
  const done = tasks.filter((task) => task.status === 'completed').length;
  return Math.round((done / tasks.length) * 100);
}

/** Finished linked tasks divided by linked tasks. An empty milestone is 0, not complete. */
export function milestoneTaskProgress(tasks: { status: string }[]): { done: number; total: number; percent: number } {
  const done = tasks.filter((task) => task.status === 'completed').length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}
