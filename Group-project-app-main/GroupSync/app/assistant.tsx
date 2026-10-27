import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button, Chip, ErrorText, Page } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { askAssistant } from '@/lib/assistant/chat';
import { resolveProposal, scheduleKind } from '@/lib/assistant/proposal';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { suggestedPrompts, type AssistantAction, type AssistantContext, type AssistantSchedule, type AssistantTask } from '@/lib/assistant/route';
import { formatAvailabilityWindow } from '@/lib/availability';
import { saveMeeting, saveMovedMeeting, saveMovedTask, saveReschedule, saveUpdate, type AssistantStore } from '@/lib/assistant/execute';
import { formatDate } from '@/lib/format';
import { preferredTimeZone } from '@/lib/timezone';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

function clockLabel(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  const face = hour % 12 || 12;
  return `${face}:${String(rest).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function workspaceNote(value: AssistantContext): string {
  const projects = value.projects.map((project) => project.name).filter(Boolean).slice(0, 8).join(', ');
  const tasks = value.tasks
    .filter((task) => task.status !== 'completed')
    .slice(0, 12)
    .map((task) => `${task.title} id=${task.id} due=${task.dueLabel} project=${task.groupName || 'Personal'}`)
    .join('; ');
  const today = `${value.now.getFullYear()}-${String(value.now.getMonth() + 1).padStart(2, '0')}-${String(value.now.getDate()).padStart(2, '0')}`;
  const meetings = value.meetings.slice(0, 8).map((meeting) => (
    `${meeting.title} id=${meeting.id} day=${meeting.day} ${clockLabel(meeting.startMinute)}-${clockLabel(meeting.endMinute)} minutes=${meeting.startMinute}-${meeting.endMinute} project=${meeting.groupName}`
  )).join('; ');
  let others = 0;
  const hours = (value.schedules ?? []).slice(0, 8).map((schedule) => {
    const who = schedule.userId === value.userId ? 'You' : `Teammate ${++others}`;
    const windows = schedule.windows.slice(0, 7).map((window) => formatAvailabilityWindow(window.weekday, window.startMinute, window.endMinute)).join(', ');
    const away = schedule.unavailable.slice(0, 3).map((period) => `${period.start} to ${period.end}`).join(', ');
    return `${who}: ${windows || 'no weekly hours'}${away ? `; away ${away}` : ''}`;
  }).join('. ');
  return `Today: ${today}. Projects: ${projects || 'none'}. Open tasks: ${tasks || 'none'}. Upcoming meetings: ${meetings || 'none'}. Saved weekly hours: ${hours || 'none'}.`;
}

function schedulesFor(
  windows: { user_id: string; weekday: number; start_minute: number; end_minute: number }[],
  unavailable: { user_id: string; starts_on: string; ends_on: string }[],
): AssistantSchedule[] {
  const ids = new Set([...windows.map((window) => window.user_id), ...unavailable.map((period) => period.user_id)]);
  return [...ids].map((userId) => ({
    userId,
    windows: windows.filter((window) => window.user_id === userId).map((window) => ({
      weekday: window.weekday,
      startMinute: window.start_minute,
      endMinute: window.end_minute,
    })),
    unavailable: unavailable.filter((period) => period.user_id === userId).map((period) => ({
      start: period.starts_on,
      end: period.ends_on,
    })),
  }));
}

type Bubble = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  action: AssistantAction;
  state: 'open' | 'done' | 'cancelled';
};

export default function AssistantScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ q?: string; groupId?: string }>();
  const focusGroupId = firstParam(params.groupId);
  const { user, profile } = useAuth();
  const { groups, tasks, events, windows, unavailable, loading, refresh } = useWorkspace();
  const [draft, setDraft] = useState('');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thinking, setThinking] = useState(false);
  const thinkingRef = useRef(false);
  const startedQuery = useRef('');
  const sendRef = useRef<(value: string) => void>(() => undefined);
  const [members, setMembers] = useState<{ groupId: string; userId: string }[]>([]);
  const timeZone = preferredTimeZone(profile?.timezone);

  useEffect(() => {
    let alive = true;
    void supabase.from('group_memberships').select('group_id, user_id').then(({ data }) => {
      if (!alive || !data) return;
      setMembers(data.flatMap((row) => {
        const groupId = typeof row.group_id === 'string' ? row.group_id : '';
        const userId = typeof row.user_id === 'string' ? row.user_id : '';
        return groupId && userId ? [{ groupId, userId }] : [];
      }));
    });
    return () => {
      alive = false;
    };
  }, [groups.length]);

  const context = useMemo<AssistantContext>(() => {
    const projects = groups.filter((group) => group.status !== 'archived').map((group) => ({
      id: group.id,
      name: group.name,
      deadline: group.deadline ?? null,
    }));
    const mapped: AssistantTask[] = tasks.filter((task) => !task.skipped).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      dueLabel: task.due_at ? formatDate(task.due_at, { timeZone }) : 'no due date',
      groupId: task.group_id,
      groupName: task.group?.name ?? null,
      blockedReason: task.blocked_reason || '',
      assigneeIds: (task.assignments ?? []).map((item) => item.user_id),
      createdBy: task.created_by,
      estimatedMinutes: task.estimated_minutes ?? null,
      priority: task.priority,
    }));
    return {
      userId: user?.id || '',
      now: new Date(),
      projects,
      tasks: mapped,
      focusGroupId: focusGroupId || null,
      windows: windows.filter((window) => window.user_id === user?.id).map((window) => ({
        weekday: window.weekday,
        startMinute: window.start_minute,
        endMinute: window.end_minute,
      })),
      unavailable: unavailable.filter((period) => period.user_id === user?.id).map((period) => ({
        start: period.starts_on,
        end: period.ends_on,
      })),
      members,
      schedules: schedulesFor(windows, unavailable),
      meetings: events.flatMap((event) => {
        if (event.kind !== 'meeting' || !event.starts_at || !event.ends_at) return [];
        const start = new Date(event.starts_at);
        const end = new Date(event.ends_at);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
        const day = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
        return [{
          id: event.id,
          title: event.title,
          groupId: event.group_id,
          groupName: event.group?.name || 'Project',
          day,
          startMinute: start.getUTCHours() * 60 + start.getUTCMinutes(),
          endMinute: end.getUTCHours() * 60 + end.getUTCMinutes(),
        }];
      }),
      busy: events.flatMap((event) => {
        if (!event.starts_at || !event.ends_at) return [];
        const start = new Date(event.starts_at);
        const end = new Date(event.ends_at);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
        const day = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
        return [{ day, startMinute: start.getUTCHours() * 60 + start.getUTCMinutes(), endMinute: end.getUTCHours() * 60 + end.getUTCMinutes() }];
      }),
    };
  }, [events, focusGroupId, groups, members, tasks, timeZone, unavailable, user?.id, windows]);

  const prompts = suggestedPrompts(context);

  const store: AssistantStore = {
    taskDue: async (id) => tasks.find((task) => task.id === id)?.due_at ?? null,
    updateTask: async (id, values) => {
      const { error: issue } = await supabase.from('tasks').update(values).eq('id', id);
      return issue?.message ?? null;
    },
    findLog: async (groupId, day, accomplishments) => {
      const { data, error: issue } = await supabase.from('progress_logs').select('id').eq('group_id', groupId).eq('log_date', day).eq('accomplishments', accomplishments).limit(1);
      if (issue) return false;
      return Boolean(data?.length);
    },
    insertLog: async (row) => {
      const { error: issue } = await supabase.from('progress_logs').insert(row);
      return issue?.message ?? null;
    },
    findEvent: async (groupId, startsAt, title) => {
      const { data, error: issue } = await supabase.from('events').select('id').eq('group_id', groupId).eq('starts_at', startsAt).eq('title', title).limit(1);
      if (issue) return false;
      return Boolean(data?.length);
    },
    insertEvent: async (row) => {
      const { data, error: issue } = await supabase.from('events').insert({ ...row, description: '', location: '' }).select('id').single();
      return { id: data?.id ?? null, error: issue?.message ?? null };
    },
    insertMeeting: async (row) => {
      const { error: issue } = await supabase.from('meetings').insert({ ...row, description: '', agenda: '', location: '' });
      return issue?.message ?? null;
    },
    updateEvent: async (id, values) => {
      const existing = await supabase.from('events').select('id').eq('id', id).maybeSingle();
      if (existing.error) return existing.error.message;
      if (!existing.data) return 'That calendar item was not found.';
      const { data, error: issue } = await supabase.from('events').update(values).eq('id', id).select('id');
      if (issue) return issue.message;
      if (!data?.length) return 'The meeting was not changed. Join the project and try again.';
      return null;
    },
    updateMeetingTimes: async (eventId, values) => {
      const existing = await supabase.from('meetings').select('id').eq('event_id', eventId).maybeSingle();
      if (existing.error) return existing.error.message;
      if (!existing.data) return null;
      const { data, error: issue } = await supabase.from('meetings').update(values).eq('id', existing.data.id).select('id');
      if (issue) return issue.message;
      if (!data?.length) return 'The meeting was not changed. Join the project and try again.';
      return null;
    },
  };

  const send = (value: string) => {
    const said = value.trim();
    if (!said || thinkingRef.current) return;
    if (!user) {
      setError('Sign in again before asking.');
      return;
    }
    const history = bubbles
      .filter((bubble) => bubble.text.trim())
      .map((bubble) => ({ role: bubble.role, text: bubble.text }));
    setError('');
    setDraft('');
    setBubbles((current) => [
      ...current,
      { id: `user-${current.length}`, role: 'user', text: said, action: { kind: 'none' }, state: 'done' },
    ]);
    thinkingRef.current = true;
    setThinking(true);
    void (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
        if (!token || !url) throw new Error('Sign in again before asking.');
        const reply = await askAssistant({
          supabaseUrl: url,
          accessToken: token,
          apiKey: isSupabaseConfigured ? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY : undefined,
          messages: [...history, { role: 'user', text: said }],
          context: workspaceNote(context),
        });
        const action = resolveProposal(reply.action, context);
        const text = action.kind === 'none' && scheduleKind(reply.action)
          ? `${reply.reply} I could not match that to a saved task or meeting, so nothing is ready to confirm.`
          : reply.reply;
        setBubbles((current) => [
          ...current,
          { id: `assistant-${current.length}`, role: 'assistant', text, action, state: action.kind === 'none' ? 'done' : 'open' },
        ]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The assistant could not answer.');
      } finally {
        thinkingRef.current = false;
        setThinking(false);
      }
    })();
  };

  useEffect(() => {
    sendRef.current = send;
  });

  const opening = firstParam(params.q);
  useEffect(() => {
    if (loading || !opening || startedQuery.current === opening) return;
    startedQuery.current = opening;
    sendRef.current(opening);
  }, [loading, opening]);

  const confirm = async (bubble: Bubble) => {
    if (busy || bubble.state !== 'open') return;
    setBusy(true);
    setError('');
    let message = 'That action is not available.';
    try {
      if (bubble.action.kind === 'move-task') message = await saveMovedTask(store, bubble.action.taskId, bubble.action.day);
      else if (bubble.action.kind === 'reschedule') message = await saveReschedule(store, bubble.action.moves);
      else if (bubble.action.kind === 'post-update') message = await saveUpdate(store, bubble.action.groupId, bubble.action.accomplishments);
      else if (bubble.action.kind === 'move-meeting') {
        message = await saveMovedMeeting(store, {
          eventId: bubble.action.eventId,
          day: bubble.action.day,
          startMinute: bubble.action.startMinute,
          endMinute: bubble.action.endMinute,
        });
      } else if (bubble.action.kind === 'create-meeting') {
        message = await saveMeeting(store, {
          groupId: bubble.action.groupId,
          title: bubble.action.title,
          day: bubble.action.day,
          startMinute: bubble.action.startMinute,
          endMinute: bubble.action.endMinute,
        });
      }
      const failed = /fail|not |could not|invalid|write what/i.test(message) && !/was saved|was posted|was added|already/i.test(message);
      if (!failed) await refresh();
      const result: Bubble = { id: `result-${bubble.id}`, role: 'assistant', text: message, action: { kind: 'none' }, state: 'done' };
      setBubbles((current) => [...current.map((item) => item.id === bubble.id ? { ...item, state: 'done' as const } : item), result]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.lead}>Ask in a sentence. Gemini proposes the change, and the calendar updates when you confirm.</Text>
        {!bubbles.length ? (
          <View style={styles.prompts}>
            {prompts.map((prompt) => (
              <Chip key={prompt} label={prompt} onPress={() => send(prompt)} />
            ))}
          </View>
        ) : null}
        {bubbles.map((bubble) => (
          <View key={bubble.id} style={bubble.role === 'user' ? styles.user : styles.reply}>
            <Text style={bubble.role === 'user' ? styles.userText : styles.replyText}>{bubble.text}</Text>
            {bubble.role === 'assistant' && bubble.state === 'open' && bubble.action.kind === 'open-plan' ? (
              <Button
                title="Review plan"
                onPress={() => router.push({
                  pathname: '/plan',
                  params: {
                    mode: bubble.action.kind === 'open-plan' ? bubble.action.mode : 'new',
                    name: bubble.action.kind === 'open-plan' ? bubble.action.name : '',
                    outcome: bubble.action.kind === 'open-plan' ? bubble.action.outcome : '',
                    groupId: bubble.action.kind === 'open-plan' ? bubble.action.groupId || '' : '',
                    revision: bubble.action.kind === 'open-plan' ? bubble.action.revision : '',
                  },
                })}
              />
            ) : null}
            {bubble.role === 'assistant' && bubble.state === 'open' && bubble.action.kind !== 'none' && bubble.action.kind !== 'open-plan' ? (
              <View style={styles.actions}>
                <Button title={busy ? 'Saving…' : 'Confirm'} onPress={() => void confirm(bubble)} disabled={busy} />
                <Button title="Cancel" secondary onPress={() => setBubbles((current) => current.map((item) => item.id === bubble.id ? { ...item, state: 'cancelled' } : item))} disabled={busy} />
              </View>
            ) : null}
          </View>
        ))}
        {thinking ? <Text style={styles.lead}>Asking…</Text> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask Syncro"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            editable={!thinking}
            onSubmitEditing={() => send(draft)}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: thinking }} disabled={thinking} onPress={() => send(draft)} style={styles.send}>
            <Text style={styles.sendText}>{thinking ? 'Sending' : 'Send'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
    lead: { color: colors.muted, lineHeight: 20, marginBottom: 12 },
    prompts: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
    user: { alignSelf: 'flex-end' as const, backgroundColor: colors.forestFill, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, maxWidth: '90%' as const },
    userText: { color: colors.onForest, fontSize: 15, lineHeight: 21 },
    reply: { alignSelf: 'flex-start' as const, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, maxWidth: '100%' as const, gap: 8 },
    replyText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
    actions: { gap: 8 },
    composer: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const, marginTop: 8 },
    input: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.surface },
    send: { backgroundColor: colors.primary, borderRadius: 14, minHeight: 48, paddingHorizontal: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
    sendText: { color: colors.primaryForeground, fontWeight: '700' as const },
  } as const;
}
