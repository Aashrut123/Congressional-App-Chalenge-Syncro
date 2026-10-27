import { useEffect, useState } from 'react';

import {
  loadAvailability,
  loadEvents,
  loadGroups,
  loadNotifications,
  loadProgressLogs,
  loadTasks,
  subscribeToGroupData,
} from '@/features/data/queries';
import { encodeWallClock, decodeWallClock } from '@/lib/format';
import { nextOccurrence, parseRule } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import type {
  AppNotification,
  AvailabilityWindow,
  CalendarEvent,
  Group,
  ProgressLog,
  Task,
  TaskStatus,
  UnavailablePeriod,
} from '@/types/database';

type WorkspaceSnapshot = {
  groups: Group[];
  events: CalendarEvent[];
  tasks: Task[];
  logs: ProgressLog[];
  notifications: AppNotification[];
  windows: AvailabilityWindow[];
  unavailable: UnavailablePeriod[];
  loading: boolean;
  error: string;
};

const empty: WorkspaceSnapshot = {
  groups: [],
  events: [],
  tasks: [],
  logs: [],
  notifications: [],
  windows: [],
  unavailable: [],
  loading: true,
  error: '',
};

let snapshot: WorkspaceSnapshot = empty;
const listeners = new Set<(value: WorkspaceSnapshot) => void>();
let refreshId = 0;
let started = false;

function emit(next: WorkspaceSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener(snapshot));
}

function patchTasks(tasks: Task[]) {
  emit({ ...snapshot, tasks });
}

export async function refreshWorkspace() {
  const id = ++refreshId;
  try {
    const [groups, events, tasks] = await Promise.all([loadGroups(), loadEvents(), loadTasks()]);
    const [logs, notifications, availability] = await Promise.allSettled([
      loadProgressLogs(),
      loadNotifications(),
      loadAvailability(),
    ]);
    if (id !== refreshId) return;
    emit({
      groups,
      events,
      tasks,
      logs: logs.status === 'fulfilled' ? logs.value : [],
      notifications: notifications.status === 'fulfilled' ? notifications.value : [],
      windows: availability.status === 'fulfilled' ? availability.value.windows : [],
      unavailable: availability.status === 'fulfilled' ? availability.value.unavailable : [],
      loading: false,
      error: '',
    });
  } catch (cause) {
    if (id !== refreshId) return;
    emit({
      ...snapshot,
      loading: false,
      error: cause instanceof Error ? cause.message : 'Could not load your workspace.',
    });
  }
}

function migrationHint(message: string) {
  return /advance_recurring_task|recurrence|series_id|occurrence_index|schema cache|column/i.test(message)
    ? 'Run the latest SQL migration in Supabase, then try again.'
    : message;
}

/** Writes finished or not-finished once, then every screen reading the workspace sees it. */
export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const previous = snapshot.tasks;
  const current = previous.find((task) => task.id === taskId);
  if (status !== 'completed' && current?.series_id) {
    const later = previous.some((task) => (
      task.series_id === current.series_id
      && (task.occurrence_index ?? 0) > (current.occurrence_index ?? 0)
    ));
    if (later) {
      throw new Error('The next occurrence is already open. Leave this one finished.');
    }
  }
  patchTasks(previous.map((task) => (task.id === taskId ? { ...task, status } : task)));
  if (status === 'completed' && current?.recurrence && current.series_id) {
    const rule = parseRule(current.recurrence);
    const due = current.due_at ? decodeWallClock(current.due_at) : new Date();
    const next = rule ? nextOccurrence(due, rule, (current.occurrence_index ?? 0) + 1) : null;
    const { error } = await supabase.rpc('advance_recurring_task', {
      p_task_id: taskId,
      p_next_due: next ? encodeWallClock(next) : null,
      p_skipped: false,
    });
    if (error) {
      patchTasks(previous);
      throw new Error(migrationHint(error.message));
    }
    await refreshWorkspace();
    return;
  }
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
  if (error) {
    patchTasks(previous);
    throw new Error(migrationHint(error.message));
  }
  await refreshWorkspace();
}

export async function skipRecurringTask(taskId: string) {
  const current = snapshot.tasks.find((task) => task.id === taskId);
  const rule = parseRule(current?.recurrence);
  const due = current?.due_at ? decodeWallClock(current.due_at) : new Date();
  const next = current?.series_id && rule
    ? nextOccurrence(due, rule, (current.occurrence_index ?? 0) + 1)
    : null;
  const { error } = await supabase.rpc('advance_recurring_task', {
    p_task_id: taskId,
    p_next_due: next ? encodeWallClock(next) : null,
    p_skipped: true,
  });
  if (error) throw new Error(migrationHint(error.message));
  await refreshWorkspace();
}

export async function stopRecurringTask(taskId: string, scope: 'this' | 'future' | 'series') {
  if (scope === 'this') {
    await skipRecurringTask(taskId);
    return;
  }
  const { error } = await supabase.rpc('stop_recurring_task', {
    p_task_id: taskId,
    p_scope: scope,
  });
  if (error) throw new Error(migrationHint(error.message));
  await refreshWorkspace();
}

function ensureStarted() {
  if (started) return;
  started = true;
  void refreshWorkspace();
  subscribeToGroupData(() => {
    void refreshWorkspace();
  });
}

export function useWorkspace() {
  const [state, setState] = useState(snapshot);

  useEffect(() => {
    listeners.add(setState);
    ensureStarted();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return { ...state, refresh: refreshWorkspace };
}
