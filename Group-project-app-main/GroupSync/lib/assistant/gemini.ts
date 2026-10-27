export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type PreparedChat =
  | { ok: true; messages: ChatTurn[]; context: string }
  | { ok: false; error: string };

const maxTurns = 20;
const maxTurnChars = 4_000;
const maxContextChars = 6_000;

export function prepareChat(input: unknown): PreparedChat {
  const record = input && typeof input === 'object' ? input as { messages?: unknown; context?: unknown } : null;
  if (!record || !Array.isArray(record.messages)) return { ok: false, error: 'Send a message.' };
  const messages: ChatTurn[] = [];
  for (const item of record.messages) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    messages.push({ role, text: trimmed.slice(0, maxTurnChars) });
  }
  const kept = messages.slice(-maxTurns);
  if (!kept.length || kept[kept.length - 1]?.role !== 'user') return { ok: false, error: 'Write a message before asking.' };
  const context = typeof record.context === 'string' ? record.context.trim().slice(0, maxContextChars) : '';
  return { ok: true, messages: kept, context };
}

export function geminiContents(messages: ChatTurn[]): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' as const : 'user' as const;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n${message.text}`;
    else contents.push({ role, parts: [{ text: message.text }] });
  }
  if (contents[0]?.role === 'model') contents.unshift({ role: 'user', parts: [{ text: 'Continue this conversation.' }] });
  return contents;
}

export function readGeminiText(payload: unknown): string {
  const candidates = (payload as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] } | null)?.candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  return parts.filter((part) => part.thought !== true).map((part) => part.text ?? '').join('').trim();
}

export function readAssistantPayload(text: string): { reply: string; action: unknown } {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(body) as { reply?: unknown; action?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.reply === 'string' && parsed.reply.trim()) {
      return { reply: parsed.reply.trim(), action: parsed.action ?? null };
    }
  } catch {
    // A plain sentence is still a usable reply.
  }
  return { reply: trimmed, action: null };
}
