// Supabase Edge Function. Deploy with: supabase functions deploy assistant
// GEMINI_API_KEY is an Edge Function secret. The app never receives the key.

import { geminiContents, prepareChat, readAssistantPayload, readGeminiText } from '../../../lib/assistant/gemini.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const models = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
const maxBodyBytes = 48_000;
const geminiTimeoutMs = 25_000;

const instructions = `You are Syncro's assistant for a student team. Every chat message is routed to you.
Return only a JSON object with "reply" and "action". No markdown.
reply is plain sentences. When you propose a calendar change, name the task or meeting, the new day and time, and say they must confirm. Do not say the change is already saved. Do not say rescheduling is impossible.
action is null unless they asked to move or reschedule a task or meeting whose id is in the workspace notes.
Use exactly one of these shapes, with only ids copied from the notes:
{"kind":"move-meeting","eventId":"<meeting id>","day":"YYYY-MM-DD","startMinute":960,"endMinute":1020}
{"kind":"move-task","taskId":"<task id>","day":"YYYY-MM-DD"}
{"kind":"reschedule","moves":[{"taskId":"<task id>","day":"YYYY-MM-DD","startMinute":960,"endMinute":1020}]}
startMinute and endMinute are integer minutes after midnight, and endMinute is later. Keep the existing length unless they asked for a different one. Choose a time inside the saved weekly hours when those hours are listed. If you cannot match one saved item, set action to null and ask which one.
If the notes do not contain the answer, say what is missing. Do not invent teammates, deadlines, or completed work.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in required.' }, 401);

  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (declaredLength > maxBodyBytes) return json({ error: 'That message is too large.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'The assistant is not configured.' }, 500);

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
  if (raw.length > maxBodyBytes) return json({ error: 'That message is too large.' }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const prepared = prepareChat(body);
  if (!prepared.ok) return json({ error: prepared.error }, 400);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'AI is not configured.' }, 503);
  const redact = (text: string) => text.split(apiKey).join('[redacted]');
  const system = prepared.context
    ? `${instructions}\n\nWorkspace notes:\n${prepared.context}`
    : instructions;

  type AskResult = { status: 200; reply: string; action: unknown } | { status: number; error: string };
  const ask = async (modelName: string): Promise<AskResult> => {
    let aiResponse: Response;
    try {
      aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(geminiTimeoutMs),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: geminiContents(prepared.messages),
            generationConfig: {
              temperature: 0.2,
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
    const text = readGeminiText(payload);
    const parsed = readAssistantPayload(text);
    if (!parsed.reply) return { status: 502, error: 'The assistant returned an empty reply.' };
    return { status: 200, reply: parsed.reply, action: parsed.action };
  };

  let last: AskResult = { status: 503, error: 'Gemini is busy right now. Try again in a moment.' };
  for (const modelName of models) {
    const result = await ask(modelName);
    last = result;
    if ('reply' in result) return json({ reply: result.reply, action: result.action ?? null });
    if (result.status !== 503 && result.status !== 404 && result.status !== 504) return json({ error: result.error }, result.status);
    console.error(`Gemini model ${modelName} was unavailable.`);
  }
  return json({ error: 'error' in last ? last.error : 'The AI provider returned an error.' }, 'error' in last ? last.status : 502);
});
