import { schedulePlan } from './schedule';
import type { GeneratedPlan, PlannerInput } from './types';
import { parseGeneratedPlan, validatePlannerInput } from './validate';

export interface GenerateOptions {
  /** When set, a signed-in request is sent to the plan Edge Function. */
  useAi?: boolean;
  supabaseUrl?: string;
  accessToken?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export async function generatePlan(input: PlannerInput, options: GenerateOptions = {}): Promise<GeneratedPlan> {
  const validated = validatePlannerInput(input);
  if (!validated.ok) throw new Error(validated.error);
  if (!options.useAi || !options.supabaseUrl || !options.accessToken) {
    throw new Error('Sign in again before generating a plan.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 150_000);
  try {
    const response = await fetch(`${options.supabaseUrl.replace(/\/$/, '')}/functions/v1/plan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.apiKey ? { apikey: options.apiKey } : {}),
      },
      body: JSON.stringify({
        input: {
          operation: validated.value.operation ?? 'new',
          groupId: validated.value.operation === 'revise' ? validated.value.groupId : null,
          title: validated.value.title,
          outcome: validated.value.outcome,
          startDate: validated.value.startDate,
          deadline: validated.value.deadline || null,
          notes: validated.value.notes,
          weeklyHoursDefault: validated.value.weeklyHoursDefault,
          projectType: validated.value.projectType || '',
          revision: validated.value.revision || '',
          milestones: validated.value.milestones,
          members: validated.value.members.map((member) => ({
            id: member.id,
            name: member.name,
            weeklyHours: member.weeklyHours,
            availableWeekdays: member.availableWeekdays,
            unavailable: member.unavailable,
            skills: member.skills,
          })),
          existingTasks: validated.value.existingTasks.map((task) => ({
            title: task.title,
            status: task.status,
            estimatedMinutes: task.estimatedMinutes ?? null,
            dueDate: task.dueDate ?? null,
            assigneeId: task.assigneeId ?? null,
          })),
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = 'The AI service did not return a plan.';
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error.length > 0 && body.error.length < 180 && !/key|token|secret/i.test(body.error)) {
          detail = body.error;
        }
      } catch {
        detail = 'The AI service did not return a plan.';
      }
      throw new Error(detail);
    }
    const payload = (await response.json()) as { plan?: unknown };
    const parsed = parseGeneratedPlan(payload.plan, validated.value.members, {
      startDate: validated.value.startDate,
      deadline: validated.value.deadline || null,
    });
    if (!parsed.ok) throw new Error(parsed.error);
    if (!parsed.value.tasks.length) throw new Error('The AI planner returned no tasks.');
    const scheduled = schedulePlan({
      ...parsed.value,
      source: 'ai',
      notices: ['This schedule came from the AI planner. Dates and feasibility were checked against the team hours. Nothing is saved until you confirm.'],
    }, {
      startDate: validated.value.startDate,
      deadline: validated.value.deadline || null,
      weeklyHours: validated.value.weeklyHoursDefault,
      notes: [validated.value.outcome, validated.value.notes, validated.value.revision].filter(Boolean).join('\n'),
      members: validated.value.members.map((member) => ({
        id: member.id,
        name: member.name,
        weeklyHours: member.weeklyHours,
        availableWeekdays: member.availableWeekdays,
        unavailable: member.unavailable,
        skills: member.skills,
      })),
      existingTasks: validated.value.existingTasks,
    });
    return scheduled;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('The AI request timed out. Nothing was saved.');
    }
    if (error instanceof TypeError) {
      throw new Error('The AI service could not be reached. Nothing was saved.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
