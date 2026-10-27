// Supabase Edge Function. Deploy with: supabase functions deploy plan
// GEMINI_API_KEY is an Edge Function secret. The app never receives the key.
// This function returns a draft and does not save tasks.

import { schedulePlan } from '../../../lib/planner/schedule.ts';
import { parseGeneratedPlan, validatePlanRequest } from '../../../lib/planner/validate.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const models = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
const maxBodyBytes = 48_000;
const geminiTimeoutMs = 25_000;

const instructions = `You are a project planner for student teams. Return only JSON with this shape:
{
  "feasible": boolean,
  "summary": string,
  "assumptions": string[],
  "questions": string[],
  "risks": string[],
  "phases": [{"name": string, "summary": string}],
  "milestones": [{"title": string, "dueDate": "YYYY-MM-DD"}],
  "tasks": [{
    "title": string,
    "description": string,
    "phase": string,
    "assigneeId": null,
    "priority": "low" | "medium" | "high",
    "estimatedMinutes": number,
    "startDate": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD",
    "dependsOnTitles": string[],
    "microGoals": string[]
  }]
}
Rules: operation "new" means no project exists yet. operation "revise" means propose only the smallest additions or adjustments around existingTasks. Do not repeat completed work and do not tell the user to delete it. Phases are ordered. Every task is specific and independently checkable. Put a measurable "Done when" line in the description. dependsOnTitles may name only other task titles in this plan, with no cycles. estimatedMinutes is required and must be between 15 and 480. Leave assigneeId null. Do not invent people, skills, or completed work. Include testing, review, and submission tasks when the project type needs them. If the deadline cannot fit the hours, set feasible to false and explain the tradeoff in risks. Ask a question only when the outcome, deadline, or team hours are missing. Suggest milestones that match real progress. The notes field is extra context, not a required list of blockers. The app recalculates dates from capacity, so estimates and dependencies matter more than the dates you choose.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function planText(payload: unknown): string {
  const candidates = (payload as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  return parts.filter((part) => part.thought !== true).map((part) => part.text ?? '').join('').trim();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in required.' }, 401);

  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (declaredLength > maxBodyBytes) return json({ error: 'The plan request is too large.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'The planner is not configured.' }, 500);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return json({ error: 'Sign in required.' }, 401);
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return json({ error: 'Sign in required.' }, 401);

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }
  if (raw.length > maxBodyBytes) return json({ error: 'The plan request is too large.' }, 413);

  let body: { input?: unknown };
  try {
    body = JSON.parse(raw) as { input?: unknown };
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const requested = validatePlanRequest(body.input ?? body);
  if (!requested.ok) return json({ error: requested.error }, 400);

  if (requested.value.groupId) {
    const membership = await fetch(
      `${supabaseUrl}/rest/v1/group_memberships?group_id=eq.${requested.value.groupId}&user_id=eq.${user.id}&select=user_id`,
      { headers: { Authorization: authorization, apikey: anonKey, Accept: 'application/json' } },
    );
    if (!membership.ok) return json({ error: 'Could not check project access.' }, 403);
    const rows = await membership.json();
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'You are not a member of this project.' }, 403);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'AI is not configured.' }, 503);
  const bounds = { startDate: requested.value.startDate, deadline: requested.value.deadline };
  const redact = (text: string) => text.split(apiKey).join('[redacted]');

  type AskResult = { status: 200; json: unknown } | { status: number; error: string };
  const ask = async (prompt: string, modelName: string): Promise<AskResult> => {
    let aiResponse: Response;
    try {
      aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(geminiTimeoutMs),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: 'low', includeThoughts: false },
            },
          }),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      console.error('Gemini request failed before a response:', message);
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /timed out/i.test(message));
      return { status: timedOut ? 504 : 502, error: timedOut ? 'The AI request timed out.' : 'The AI provider could not be reached.' };
    }
    if (!aiResponse.ok) {
      const failureBody = await aiResponse.text();
      console.error(`Gemini request failed with status ${aiResponse.status}: ${redact(failureBody).slice(0, 2000)}`);
      if (aiResponse.status === 429) return { status: 429, error: 'Rate limited.' };
      if (aiResponse.status === 503) return { status: 503, error: 'Gemini is busy right now. Try again in a moment.' };
      return { status: 502, error: 'The AI provider returned an error.' };
    }
    let payload: unknown;
    try {
      payload = await aiResponse.json();
    } catch {
      return { status: 502, error: 'The AI provider returned malformed JSON.' };
    }
    const content = planText(payload).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!content) return { status: 502, error: 'The AI provider returned an empty plan.' };
    try {
      return { status: 200, json: JSON.parse(content) as unknown };
    } catch {
      return { status: 502, error: 'The AI provider returned malformed JSON.' };
    }
  };

  const accept = (value: unknown) => parseGeneratedPlan(value, requested.value.members, bounds);
  const finish = (value: ReturnType<typeof accept>) => {
    if (!value.ok) return value;
    return {
      ok: true as const,
      value: schedulePlan(value.value, {
        startDate: requested.value.startDate,
        deadline: requested.value.deadline,
        weeklyHours: requested.value.weeklyHours,
        notes: [requested.value.outcome, requested.value.notes, requested.value.revision].filter(Boolean).join('\n'),
        members: requested.value.members.map((member) => ({
          ...member,
          weeklyHours: member.weeklyHours ?? requested.value.weeklyHours ?? 6,
        })),
        existingTasks: requested.value.existingTasks,
      }),
    };
  };
  const askUntilAvailable = async (prompt: string): Promise<AskResult> => {
    let last: AskResult = { status: 503, error: 'Gemini is busy right now. Try again in a moment.' };
    for (const modelName of models) {
      const result = await ask(prompt, modelName);
      last = result;
      if (!('error' in result) || (result.status !== 503 && result.status !== 404 && result.status !== 504)) return result;
      console.error(`Gemini model ${modelName} was unavailable.`);
    }
    return last;
  };
  const first = await askUntilAvailable(JSON.stringify(requested.value));
  if ('error' in first && first.status === 429) return json({ error: 'Rate limited.' }, 429);
  const firstPlan = 'json' in first ? finish(accept(first.json)) : null;
  if (firstPlan?.ok) return json({ plan: firstPlan.value });

  const invalidOutput = Boolean(firstPlan && !firstPlan.ok)
    || ('error' in first && (first.error === 'The AI provider returned malformed JSON.' || first.error === 'The AI provider returned an empty plan.'));
  if (invalidOutput) {
    const reason = firstPlan && !firstPlan.ok ? firstPlan.error : 'error' in first ? first.error : 'The plan was incomplete.';
    const second = await askUntilAvailable(`The previous JSON was rejected: ${reason}. Return only corrected JSON for this request.\n${JSON.stringify(requested.value)}`);
    if ('error' in second && second.status === 429) return json({ error: 'Rate limited.' }, 429);
    if ('json' in second) {
      const secondPlan = finish(accept(second.json));
      if (secondPlan.ok) return json({ plan: secondPlan.value });
      return json({ error: secondPlan.error }, 502);
    }
    return json({ error: second.error }, second.status);
  }

  return json({ error: 'error' in first ? first.error : 'The AI provider returned an error.' }, 'error' in first ? first.status : 502);
});
