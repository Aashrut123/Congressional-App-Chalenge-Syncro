import { prepareChat, type ChatTurn } from './gemini';

export interface AskAssistantOptions {
  supabaseUrl: string;
  accessToken: string;
  apiKey?: string;
  messages: ChatTurn[];
  context?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function askAssistant(options: AskAssistantOptions): Promise<{ reply: string; action: unknown }> {
  const prepared = prepareChat({ messages: options.messages, context: options.context ?? '' });
  if (!prepared.ok) throw new Error(prepared.error);
  const base = options.supabaseUrl.replace(/\/$/, '');
  if (!base || !options.accessToken) throw new Error('Sign in again before asking.');

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 40_000);
  try {
    const response = await fetchImpl(`${base}/functions/v1/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.apiKey ? { apikey: options.apiKey } : {}),
      },
      body: JSON.stringify({ messages: prepared.messages, context: prepared.context }),
      signal: controller.signal,
    });
    let payload: { reply?: unknown; error?: unknown; action?: unknown } = {};
    try {
      payload = (await response.json()) as { reply?: unknown; error?: unknown; action?: unknown };
    } catch {
      throw new Error(response.ok ? 'The assistant returned an unreadable response.' : 'The assistant could not be reached.');
    }
    if (!response.ok) {
      const detail = typeof payload.error === 'string' && payload.error.trim() && payload.error.length < 180 && !/key|token|secret/i.test(payload.error)
        ? payload.error.trim()
        : 'The assistant could not answer.';
      throw new Error(detail);
    }
    if (typeof payload.reply !== 'string' || !payload.reply.trim()) {
      throw new Error('The assistant returned an empty reply.');
    }
    return { reply: payload.reply.trim(), action: payload.action ?? null };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The assistant took too long to answer.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
