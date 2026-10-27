import assert from 'node:assert/strict';
import test from 'node:test';

import { askAssistant } from './chat.ts';
import { geminiContents, prepareChat, readGeminiText } from './gemini.ts';

test('an empty composer never becomes a Gemini request', () => {
  assert.equal(prepareChat({ messages: [{ role: 'user', text: '   ' }] }).ok, false);
  assert.equal(prepareChat({ messages: [] }).ok, false);
});

test('history stays in order and the latest user message is what Gemini sees', () => {
  const prepared = prepareChat({
    messages: [
      { role: 'user', text: 'What is due tomorrow?' },
      { role: 'assistant', text: 'AP Physics Notes.' },
      { role: 'user', text: 'Move it to Friday.' },
    ],
    context: 'Projects: Test 1',
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const contents = geminiContents(prepared.messages);
  assert.equal(contents.at(-1)?.role, 'user');
  assert.match(contents.at(-1)?.parts[0].text ?? '', /Move it to Friday/);
  assert.equal(contents[0]?.role, 'user');
  assert.match(prepared.context, /Test 1/);
});

test('the chat client posts the message to the assistant function and returns Gemini text', async () => {
  let url = '';
  let authorization = '';
  let body = '';
  const reply = await askAssistant({
    supabaseUrl: 'https://example.supabase.co/',
    accessToken: 'session-token',
    apiKey: 'publishable',
    messages: [{ role: 'user', text: 'What should I work on?' }],
    context: 'Open tasks: Algebra review',
    fetchImpl: async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ reply: 'Work on Algebra review.' }), { status: 200 });
    },
  });
  assert.equal(reply.reply, 'Work on Algebra review.');
  assert.equal(reply.action, null);
  assert.equal(url, 'https://example.supabase.co/functions/v1/assistant');
  assert.equal(authorization, 'Bearer session-token');
  assert.match(body, /What should I work on/);
  assert.doesNotMatch(body, /session-token|GEMINI_API_KEY/);
});

test('an API error is shown and not replaced with a local reply', async () => {
  await assert.rejects(
    () => askAssistant({
      supabaseUrl: 'https://example.supabase.co',
      accessToken: 'session-token',
      messages: [{ role: 'user', text: 'Hello' }],
      fetchImpl: async () => new Response(JSON.stringify({ error: 'AI is not configured.' }), { status: 503 }),
    }),
    /AI is not configured/,
  );
});

test('a calendar action from the assistant function is returned with the reply', async () => {
  const result = await askAssistant({
    supabaseUrl: 'https://example.supabase.co',
    accessToken: 'session-token',
    messages: [{ role: 'user', text: 'Push Meet 1 to Nov 5' }],
    fetchImpl: async () => new Response(JSON.stringify({
      reply: 'Move Meet 1 to November 5 at 4:00 PM. Confirm to save it.',
      action: { kind: 'move-meeting', eventId: 'm1', day: '2026-11-05', startMinute: 960, endMinute: 1020 },
    }), { status: 200 }),
  });
  assert.match(result.reply, /Confirm/);
  assert.equal((result.action as { eventId?: string }).eventId, 'm1');
});

test('an empty Gemini payload is an error', () => {
  assert.equal(readGeminiText({ candidates: [{ content: { parts: [{ text: '   ', thought: false }] } }] }), '');
  assert.equal(readGeminiText({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'Visible answer' }] } }] }), 'Visible answer');
});
