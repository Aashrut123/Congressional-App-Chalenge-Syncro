import { encodeWallClock } from '@/lib/format';
import { partitionPlanTasks } from '@/lib/planner/changes';
import { validateApprovedTasks, type PlanBounds } from '@/lib/planner/draft';
import type { GeneratedPlan, PlanMeeting, PlanTask } from '@/lib/planner/types';
import { supabase } from '@/lib/supabase';

export interface SavePlanResult {
  savedTasks: number;
  skipped: string[];
  preserved: string[];
  savedMeetings: number;
  error?: string;
}

export { partitionPlanTasks } from '@/lib/planner/changes';

function dayStart(day: string, hour: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return encodeWallClock(new Date(year || 2026, (month || 1) - 1, date || 1, hour, 0, 0, 0));
}

function duplicateWrite(message: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(message);
}

export async function saveReviewedPlan(options: {
  groupId: string;
  plan: GeneratedPlan;
  tasks: PlanTask[];
  milestones: { title: string; dueDate: string }[];
  meetings: PlanMeeting[];
  input: unknown;
  clientRequestId: string;
  bounds: PlanBounds;
}): Promise<SavePlanResult> {
  const empty = { savedTasks: 0, skipped: [] as string[], preserved: [] as string[], savedMeetings: 0 };
  const approved = validateApprovedTasks(options.tasks, options.bounds);
  if (!approved.ok) return { ...empty, error: approved.error };

  const existing = await supabase.from('tasks').select('id,title,status').eq('group_id', options.groupId);
  if (existing.error) return { ...empty, error: existing.error.message };
  const existingRows = (existing.data ?? []) as { id?: string; title: string; status: string }[];
  const partitioned = partitionPlanTasks(existingRows, approved.value);

  let sessionId: string | null = null;
  if (options.clientRequestId) {
    const prior = await supabase
      .from('planning_sessions')
      .select('id')
      .eq('group_id', options.groupId)
      .contains('input', { clientRequestId: options.clientRequestId })
      .limit(1);
    if (!prior.error && prior.data?.[0]?.id) sessionId = prior.data[0].id as string;
  }

  if (!sessionId) {
    const session = await supabase
      .from('planning_sessions')
      .insert({
        group_id: options.groupId,
        source: options.plan.source,
        feasible: options.plan.feasible,
        summary: options.plan.summary,
        assumptions: options.plan.assumptions.join('\n'),
        risks: options.plan.risks.join('\n'),
        input: { ...(typeof options.input === 'object' && options.input ? options.input : {}), clientRequestId: options.clientRequestId },
        plan: { ...options.plan, tasks: approved.value, milestones: options.milestones },
        saved_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (session.error || !session.data) {
      return { ...empty, error: session.error?.message ?? 'Could not save the planning session.' };
    }
    sessionId = session.data.id as string;
  }

  const skipped = partitioned.skipped;
  const preserved = partitioned.preserved;
  const idByTitle = new Map<string, string>();
  for (const row of existingRows) {
    if (row.id) idByTitle.set(row.title.trim().toLowerCase(), row.id);
  }
  let savedTasks = 0;

  const milestoneRows = await supabase.from('milestones').select('title').eq('group_id', options.groupId);
  if (milestoneRows.error) return { savedTasks, skipped, preserved, savedMeetings: 0, error: milestoneRows.error.message };
  const milestoneTitles = new Set(
    ((milestoneRows.data ?? []) as { title: string }[]).map((row) => row.title.trim().toLowerCase()),
  );
  for (const milestone of options.milestones) {
    const key = milestone.title.trim().toLowerCase();
    if (milestoneTitles.has(key)) continue;
    const inserted = await supabase.from('milestones').insert({
      group_id: options.groupId,
      title: milestone.title,
      due_on: milestone.dueDate,
      description: 'Added from a reviewed project plan.',
    });
    if (inserted.error) {
      if (duplicateWrite(inserted.error.message)) continue;
      return { savedTasks, skipped, preserved, savedMeetings: 0, error: inserted.error.message };
    }
    milestoneTitles.add(key);
  }

  for (const task of partitioned.save) {
    const key = task.title.trim().toLowerCase();
    const inserted = await supabase
      .from('tasks')
      .insert({
        group_id: options.groupId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: 'todo',
        due_at: dayStart(task.dueDate, 17),
        starts_at: dayStart(task.startDate, 9),
        estimated_minutes: task.estimatedMinutes,
        origin: options.plan.source,
        plan_id: sessionId,
      })
      .select('id')
      .single();
    if (inserted.error || !inserted.data) {
      return { savedTasks, skipped, preserved, savedMeetings: 0, error: inserted.error?.message ?? 'Could not save a task.' };
    }
    savedTasks += 1;
    idByTitle.set(key, inserted.data.id as string);
    if (task.assigneeId) {
      const assignment = await supabase.from('task_assignments').insert({
        task_id: inserted.data.id,
        user_id: task.assigneeId,
      });
      if (assignment.error && !duplicateWrite(assignment.error.message)) {
        return { savedTasks, skipped, preserved, savedMeetings: 0, error: `Task saved, but assignment failed: ${assignment.error.message}` };
      }
    }
    if (task.microGoals.length) {
      const goals = await supabase.from('requirements').insert(
        task.microGoals.map((title) => ({ task_id: inserted.data.id, title })),
      );
      if (goals.error) {
        return { savedTasks, skipped, preserved, savedMeetings: 0, error: `Task saved, but micro-goals failed: ${goals.error.message}` };
      }
    }
  }

  const listed = await supabase.from('tasks').select('id,title').eq('group_id', options.groupId);
  if (!listed.error) {
    for (const row of (listed.data ?? []) as { id: string; title: string }[]) {
      idByTitle.set(row.title.trim().toLowerCase(), row.id);
    }
  }

  for (const task of approved.value) {
    const childId = idByTitle.get(task.title.trim().toLowerCase());
    if (!childId) continue;
    for (const dependencyTitle of task.dependsOnTitles) {
      const parentId = idByTitle.get(dependencyTitle.trim().toLowerCase());
      if (!parentId || parentId === childId) continue;
      const link = await supabase.from('task_dependencies').insert({ task_id: childId, depends_on: parentId });
      if (link.error && !duplicateWrite(link.error.message)) {
        return { savedTasks, skipped, preserved, savedMeetings: 0, error: link.error.message };
      }
    }
  }

  let savedMeetings = 0;
  for (const meeting of options.meetings) {
    const event = await supabase
      .from('events')
      .insert({
        group_id: options.groupId,
        title: meeting.title,
        description: meeting.agenda,
        starts_at: meeting.startsAt,
        ends_at: meeting.endsAt,
        kind: 'meeting',
        location: '',
      })
      .select('id')
      .single();
    if (event.error || !event.data) {
      return { savedTasks, skipped, preserved, savedMeetings, error: event.error?.message ?? 'Could not save a meeting.' };
    }
    const row = await supabase.from('meetings').insert({
      group_id: options.groupId,
      event_id: event.data.id,
      title: meeting.title,
      agenda: meeting.agenda,
      description: meeting.reason,
      starts_at: meeting.startsAt,
      ends_at: meeting.endsAt,
    });
    if (row.error) return { savedTasks, skipped, preserved, savedMeetings, error: row.error.message };
    savedMeetings += 1;
  }

  return { savedTasks, skipped, preserved, savedMeetings };
}
