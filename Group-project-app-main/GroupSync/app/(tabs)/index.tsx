import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Chip, EmptyState, ErrorText, Loading, Page, ProgressBar } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useWorkspace } from '@/hooks/useWorkspace';
import { findConflicts } from '@/lib/planner/conflicts';
import { isStillScheduled } from '@/lib/planner/dates';
import { pickedInstant } from '@/lib/format';
import { isVisibleOccurrence, tasksForProgress } from '@/lib/recurrence';
import { preferredTimeZone, unavailableBounds } from '@/lib/timezone';
import { suggestedPrompts, type AssistantContext } from '@/lib/assistant/route';
import {
  agendaLabel,
  buildAgenda,
  formatClock,
  formatLongDate,
  formatWhen,
  greetingFor,
  isUsersTask,
  pickNextTask,
  projectTaskProgress,
  type HomeTask,
} from '@/lib/home';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

export default function HomeScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { profile, user } = useAuth();
  const timeZone = preferredTimeZone(profile?.timezone);
  const { groups, events, tasks, logs, notifications, unavailable, loading, error, refresh } = useWorkspace();
  const [ask, setAsk] = useState('');
  const { refreshControl } = usePullRefresh(refresh);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const now = new Date();
  const activeGroups = groups.filter((group) => group.status !== 'archived');
  const homeTasks = useMemo<HomeTask[]>(() => tasks.filter((task) => isVisibleOccurrence(task) || task.status === 'completed').filter((task) => !task.skipped).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.due_at ? pickedInstant(task.due_at, timeZone).toISOString() : null,
    createdBy: task.created_by,
    assigneeIds: (task.assignments ?? []).map((assignment) => assignment.user_id),
  })), [tasks, timeZone]);

  const next = user ? pickNextTask(homeTasks, user.id, now) : null;
  const nextTask = next ? tasks.find((task) => task.id === next.task.id) : undefined;
  const openMine = user ? homeTasks.filter((task) => task.status !== 'completed' && isUsersTask(task, user.id)) : [];
  const openCount = openMine.length;
  const overdueCount = openMine.filter((task) => {
    const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    return !Number.isNaN(due) && due < now.getTime();
  }).length;

  const agenda = buildAgenda(
    events.map((event) => ({
      id: event.id,
      title: event.title,
      kind: event.kind,
      startsAt: event.starts_at ? pickedInstant(event.starts_at, timeZone).toISOString() : null,
      endsAt: event.ends_at ? pickedInstant(event.ends_at, timeZone).toISOString() : null,
    })),
    homeTasks,
    now,
  ).map((item) => {
    const event = events.find((entry) => entry.id === item.id && item.href.startsWith('/event/'));
    const task = tasks.find((entry) => entry.id === item.id && item.href.startsWith('/task/'));
    return {
      ...item,
      project: event?.group?.name || task?.group?.name || (task ? 'Personal' : 'Project'),
    };
  });

  const unread = notifications.filter((item) => !item.read_at).length;

  const conflicts = useMemo(() => findConflicts([
    ...events.filter((event) => isStillScheduled(event.ends_at)).map((event) => ({
      id: event.id,
      title: event.title,
      start: event.starts_at,
      end: event.ends_at,
      kind: event.kind === 'deadline' ? 'deadline' as const : event.kind === 'meeting' ? 'meeting' as const : 'event' as const,
    })),
    ...unavailable.filter((period) => period.user_id === user?.id).map((period) => {
      const bounds = unavailableBounds(period.starts_on, period.ends_on, timeZone);
      return {
        id: period.id,
        title: period.reason || 'Unavailable',
        start: bounds.start,
        end: bounds.end,
        kind: 'unavailable' as const,
      };
    }),
  ]), [events, unavailable, user?.id, timeZone]);

  if (loading && !groups.length && !tasks.length && !events.length) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <Loading />
      </SafeAreaView>
    );
  }

  const today = formatLongDate(now, timeZone);
  const firstName = profile?.display_name?.trim().split(/\s+/)[0];
  const greeting = `${greetingFor(now, timeZone)}${firstName ? `, ${firstName}` : ''}`;
  const quick = [
    ['Task', 'add-circle-outline', '/create-task'],
    ['Meeting', 'calendar-outline', '/create-event'],
    ['Log', 'create-outline', '/progress'],
    ['Notices', 'notifications-outline', '/notifications'],
  ] as const;
  const nextDetail = nextTask
    ? `${next?.reason === 'overdue' ? 'Overdue · ' : next?.reason === 'soon' ? 'Due soon · ' : ''}${nextTask.group?.name || 'Personal'} · ${nextTask.due_at ? formatWhen(nextTask.due_at, timeZone, false) : 'No due date'}`
    : '';

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }} refreshControl={refreshControl}>
          <View style={styles.greeting}>
            <View style={{ flex: 1 }}>
              <Text style={styles.date}>{today}</Text>
              <Text style={styles.greet} numberOfLines={1}>{greeting}</Text>
              <Text style={styles.quiet}>
                {openCount} open task{openCount === 1 ? '' : 's'}
                {overdueCount ? ` · ${overdueCount} overdue` : ''}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={unread ? `Notices, ${unread} unread` : 'Notices'}
                onPress={() => router.push('/notifications')}
                style={({ pressed }) => [styles.noticeButton, pressed && styles.pressed]}
              >
                <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={22} color={colors.text} />
                {unread ? <View style={styles.headerBadge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profile"
                hitSlop={8}
                onPress={() => router.push('/profile')}
                style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
              >
                <View pointerEvents="none">
                  {profile?.avatar_url ? (
                    <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || 'G'}</Text></View>
                  )}
                </View>
              </Pressable>
            </View>
          </View>

          {error ? <ErrorText>{error}</ErrorText> : null}

          <View style={styles.hero}>
            <Text style={styles.kicker}>Work on this next</Text>
            {nextTask ? (
              <>
                <Text style={styles.nextTitle} numberOfLines={2}>{nextTask.title}</Text>
                <Text style={styles.heroQuiet}>{nextDetail}</Text>
                <View style={styles.heroActions}>
                  <Button title="Open task" onPress={() => router.push(`/task/${nextTask.id}`)} tone="forest" style={styles.heroButton} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.nextTitle}>{activeGroups.length ? 'Nothing is waiting on you' : 'One project is enough to begin'}</Text>
                <Text style={styles.heroQuiet}>
                  {activeGroups.length
                    ? 'Add a task when you know the next piece of work.'
                    : 'Invite people later, or keep the work to yourself until the team is ready.'}
                </Text>
                <View style={styles.heroActions}>
                  <Button title="Create a task" onPress={() => router.push('/create-task')} tone="forest" style={styles.heroButton} />
                  {activeGroups.length ? (
                    <Button
                      title="Plan"
                      onPress={() => router.push({ pathname: '/plan', params: { mode: 'revise', groupId: activeGroups[0]?.id } })}
                      tone="forest"
                      secondary
                      style={styles.heroButton}
                    />
                  ) : (
                    <Button title="Create a project" onPress={() => router.push('/create-group')} tone="forest" secondary style={styles.heroButton} />
                  )}
                </View>
              </>
            )}
          </View>

          <View style={styles.ask}>
            <TextInput
              value={ask}
              onChangeText={setAsk}
              placeholder="Ask about a plan, a task, or a meeting"
              placeholderTextColor={colors.textTertiary}
              style={styles.askInput}
              onSubmitEditing={() => {
                const said = ask.trim();
                if (!said) return;
                setAsk('');
                router.push({ pathname: '/assistant', params: { q: said } });
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask"
              onPress={() => {
                const said = ask.trim();
                if (!said) return;
                setAsk('');
                router.push({ pathname: '/assistant', params: { q: said } });
              }}
              style={styles.askButton}
            >
              <Text style={styles.askButtonText}>Ask</Text>
            </Pressable>
          </View>
          <View style={styles.prompts}>
            {suggestedPrompts({
              userId: user?.id || '',
              now,
              projects: activeGroups.map((group) => ({ id: group.id, name: group.name, deadline: group.deadline ?? null })),
              tasks: homeTasks.map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                dueAt: task.dueAt,
                dueLabel: '',
                groupId: null,
                groupName: null,
                blockedReason: '',
                assigneeIds: task.assigneeIds,
                createdBy: task.createdBy,
                estimatedMinutes: null,
                priority: 'medium' as const,
              })),
              windows: [],
              unavailable: [],
              busy: [],
              meetings: [],
            } satisfies AssistantContext).map((prompt) => (
              <Chip key={prompt} label={prompt} onPress={() => router.push({ pathname: '/assistant', params: { q: prompt } })} />
            ))}
          </View>

          <View style={styles.toolbar}>
            {quick.map(([label, icon, href], index) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label === 'Notices' && unread ? `Notices, ${unread} unread` : label}
                onPress={() => router.push(href)}
                style={({ pressed }) => [styles.quickItem, index > 0 && styles.quickRule, pressed && styles.pressed]}
              >
                <View>
                  <Ionicons name={icon} size={20} color={colors.primary} />
                  {label === 'Notices' && unread ? (
                    <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
                  ) : null}
                </View>
                <Text style={styles.quickText}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {conflicts.length ? (
            <Card>
              <Text style={styles.rowTitle}>Schedule conflicts</Text>
              {conflicts.slice(0, 3).map((conflict) => (
                <Text key={`${conflict.a}-${conflict.b}`} style={styles.quiet}>{conflict.a} and {conflict.b}. {conflict.reason}</Text>
              ))}
              <Button title="Review reschedule" onPress={() => router.push({ pathname: '/reschedule', params: { groupId: activeGroups[0]?.id } })} secondary />
            </Card>
          ) : null}

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Coming up</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="View calendar" onPress={() => router.push('/(tabs)/calendar')} hitSlop={8}>
              <Text style={styles.sectionLink}>Calendar</Text>
            </Pressable>
          </View>
          {agenda.length ? agenda.map((item, index) => {
            const clock = formatClock(item.at, timeZone);
            const day = formatWhen(item.at, timeZone, false);
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${agendaLabel(item.kind)}. ${item.title}`}
                onPress={() => router.push(item.href.startsWith('/task/') ? `/task/${item.id}` : `/event/${item.id}`)}
                style={({ pressed }) => [styles.agendaRow, index > 0 && styles.rule, pressed && styles.pressed]}
              >
                <View style={styles.timeCol}>
                  <Text style={styles.time}>{clock || '—'}</Text>
                  <Text style={styles.timeDate}>{day || 'No date'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{agendaLabel(item.kind)} · {item.project}</Text>
                </View>
              </Pressable>
            );
          }) : (
            <EmptyState compact title="Nothing scheduled" body="Meetings and task deadlines that are still ahead show up here." />
          )}

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Projects</Text>
            {activeGroups.length ? (
              <Pressable accessibilityRole="button" accessibilityLabel="See all projects" onPress={() => router.push('/(tabs)/groups')} hitSlop={8}>
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            ) : null}
          </View>
          {activeGroups.length ? (
            <View style={styles.projectBlock}>
              {activeGroups.map((group, index) => {
                const progress = projectTaskProgress(tasksForProgress(tasks.filter((task) => task.group_id === group.id)));
                const deadline = group.deadline ? formatWhen(group.deadline, timeZone, false) : '';
                return (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityLabel={group.name}
                    onPress={() => router.push(`/group/${group.id}`)}
                    style={({ pressed }) => [styles.projectRow, index > 0 && styles.rule, pressed && styles.pressed]}
                  >
                    <View style={styles.projectTop}>
                      <View style={[styles.dot, { backgroundColor: group.color || colors.primary }]} />
                      <Text style={styles.rowTitle} numberOfLines={1}>{group.name}</Text>
                      <Text style={styles.percent}>{progress.percent === null ? 'No tasks' : `${progress.percent}%`}</Text>
                    </View>
                    {group.description ? <Text style={styles.description} numberOfLines={2}>{group.description}</Text> : null}
                    <Text style={styles.meta}>
                      {progress.percent === null ? 'No tasks yet' : `${progress.done} of ${progress.total} tasks complete`}
                      {deadline ? ` · Due ${deadline}` : ''}
                    </Text>
                    {progress.percent === null ? null : <ProgressBar value={progress.percent} color={group.color || colors.primary} />}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <EmptyState compact title="No projects yet" body="Create one from above, or join a project with an invitation code." />
          )}

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Team updates</Text>
          </View>
          {logs.length ? logs.slice(0, 4).map((log, index) => {
            const summary = log.accomplishments || log.next_steps || log.blockers;
            const body = (
              <>
                <Text style={styles.rowTitle}>{log.profile?.display_name || 'Teammate'}</Text>
                <Text style={styles.meta}>{log.group?.name || 'Project'} · {formatWhen(log.log_date, timeZone, false) || 'No date'}</Text>
                {summary ? <Text style={styles.body} numberOfLines={2}>{summary}</Text> : null}
              </>
            );
            return log.group_id ? (
              <Pressable
                key={log.id}
                accessibilityRole="button"
                accessibilityLabel={`${log.profile?.display_name || 'Teammate'} update`}
                onPress={() => router.push(`/group/${log.group_id}`)}
                style={({ pressed }) => [styles.update, index > 0 && styles.updateGap, pressed && styles.pressed]}
              >
                {body}
              </Pressable>
            ) : (
              <View key={log.id} style={[styles.update, index > 0 && styles.updateGap]}>{body}</View>
            );
          }) : (
            <>
              <EmptyState compact title="No updates yet" body="A short progress log tells the team what actually got finished." />
              <Button title="Write an update" onPress={() => router.push('/progress')} secondary />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return {
    greeting: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12, marginBottom: 16, marginTop: 4 },
    date: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
    greet: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.3, marginTop: 2 },
    quiet: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
    headerActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    noticeButton: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarButton: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarImage: { width: 40, height: 40, borderRadius: 14 },
    avatarText: { color: colors.onMint, fontWeight: '700' as const, fontSize: 16 },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
    hero: { backgroundColor: colors.forestFill, borderRadius: 18, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 },
    heroQuiet: { color: colors.onForestMuted, fontSize: 13, lineHeight: 18, marginTop: 6 },
    nextTitle: { color: colors.onForest, fontSize: 20, lineHeight: 26, fontWeight: '700' as const, marginTop: 6, letterSpacing: -0.3 },
    heroActions: { flexDirection: 'row' as const, gap: 8, marginTop: 12 },
    heroButton: { flex: 1, marginTop: 0 },
    ask: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const, marginTop: 12 },
    askInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.surface },
    askButton: { backgroundColor: colors.primary, borderRadius: 14, minHeight: 48, paddingHorizontal: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
    askButtonText: { color: colors.primaryForeground, fontWeight: '700' as const },
    prompts: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
    pressed: { opacity: 0.72 },
    toolbar: { flexDirection: 'row' as const, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginTop: 12, marginBottom: 4, overflow: 'hidden' as const },
    quickItem: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, minHeight: 68 },
    quickRule: { borderLeftWidth: 1, borderLeftColor: colors.border },
    quickText: { color: colors.text, fontWeight: '600' as const, fontSize: 12 },
    badge: { position: 'absolute' as const, top: -6, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
    headerBadge: { position: 'absolute' as const, top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
    badgeText: { color: colors.primaryForeground, fontSize: 9, fontWeight: '700' as const },
    sectionRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, marginTop: 22, marginBottom: 8 },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' as const, letterSpacing: -0.2 },
    sectionLink: { color: colors.primary, fontSize: 13, fontWeight: '700' as const },
    agendaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 10 },
    rule: { borderTopWidth: 1, borderTopColor: colors.border },
    timeCol: { width: 64 },
    time: { color: colors.text, fontSize: 13, fontWeight: '700' as const },
    timeDate: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    rowTitle: { color: colors.text, fontWeight: '700' as const, fontSize: 15 },
    meta: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
    description: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6 },
    projectBlock: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 4 },
    projectRow: { paddingVertical: 12 },
    projectTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    percent: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' as const, marginLeft: 'auto' as const },
    update: { paddingBottom: 2 },
    updateGap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
    body: { color: colors.textSecondary, marginTop: 4, lineHeight: 20, fontSize: 14 },
  } as const;
}
