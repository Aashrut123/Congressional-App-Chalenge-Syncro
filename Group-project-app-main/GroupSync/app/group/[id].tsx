
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DateField } from '@/components/DateField';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Page,
  Pill,
  ProgressBar,
  priorityTone,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatClockFace, formatDate, pickedInstant } from '@/lib/format';
import { preferredTimeZone } from '@/lib/timezone';
import { clearInviteCode, loadInviteCode, saveInviteCode } from '@/lib/inviteCodes';
import { easeLayout, usePrefersReducedMotion } from '@/lib/motion';
import { formatDay, parseDay } from '@/lib/planner/dates';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { refreshWorkspace, updateTaskStatus, useWorkspace } from '@/hooks/useWorkspace';
import { completionPercent, milestoneTaskProgress, taskStatusLabel } from '@/lib/planner/status';
import { tasksForProgress } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type {
  CalendarEvent,
  Group,
  Membership,
  Milestone,
  ProgressLog,
  Task,
  TaskDependency,
  TaskPriority,
} from '@/types/database';

type ProjectSection = 'overview' | 'tasks' | 'milestones' | 'timeline' | 'activity';
type TaskFilter = 'open' | 'done' | 'all';

type ActivityItem = {
  id: string;
  actorId: string | null;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: string;
};

function latestChanges(items: ActivityItem[]) {
  const seen = new Set<string>();
  const kept: ActivityItem[] = [];
  for (const item of items) {
    const key = item.entityId || item.summary;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
    if (kept.length >= 8) break;
  }
  return kept;
}

const SECTIONS: { id: ProjectSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'activity', label: 'Activity' },
];

export default function GroupDetailScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const timeZone = preferredTimeZone(profile?.timezone);
  const { tasks: sharedTasks, refresh } = useWorkspace();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<ProjectSection>('overview');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('open');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [logs, setLogs] = useState<ProgressLog[]>([]);
  const [outcome, setOutcome] = useState('');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [openMilestoneId, setOpenMilestoneId] = useState<string | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDate, setMilestoneDate] = useState<Date | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const toggleFinished = (taskId: string, status: Task['status']) => {
    if (pendingTaskId) return;
    setPendingTaskId(taskId);
    void updateTaskStatus(taskId, status === 'completed' ? 'todo' : 'completed')
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not update the task.');
      })
      .finally(() => setPendingTaskId((current) => (current === taskId ? null : current)));
  };

  const load = useCallback(async () => {
    const [g, m, e, t] = await Promise.all([
      supabase
        .from('groups')
        .select('*')
        .eq('id', id)
        .single(),

      supabase
        .from('group_memberships')
        .select(
          '*, profile:profiles(id, display_name, avatar_url)'
        )
        .eq('group_id', id)
        .order('joined_at'),

      supabase
        .from('events')
        .select('*')
        .eq('group_id', id)
        .gt('ends_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('starts_at')
        .limit(10),

      supabase
        .from('tasks')
        .select('*, assignments:task_assignments(user_id, profile:profiles(display_name))')
        .eq('group_id', id)
        .order('created_at', { ascending: false }),
    ]);

    let taskRows = t;
    if (t.error) {
      taskRows = await supabase.from('tasks').select('*').eq('group_id', id).order('created_at', { ascending: false });
    }
    const issue = g.error || m.error || e.error || taskRows.error;

    if (issue) {
      setError(issue.message);
    }

    const loadedGroup = g.data as Group | null;
    setGroup(loadedGroup);
    setOutcome(loadedGroup?.outcome || '');
    setDeadline(loadedGroup?.deadline ? parseDay(loadedGroup.deadline) : null);
    setPriority(loadedGroup?.priority || 'medium');
    setMembers((m.data || []) as Membership[]);
    setEvents((e.data || []) as CalendarEvent[]);
    const loadedTasks = (taskRows.data || []) as Task[];
    setTasks(loadedTasks);
    const activityResult = await supabase
      .from('activity')
      .select('id, actor_id, entity_id, action, summary, created_at')
      .eq('group_id', id)
      .order('created_at', { ascending: false })
      .limit(40);
    setActivity(activityResult.error ? [] : (activityResult.data as { id: number; actor_id: string | null; entity_id: string | null; action: string; summary: string; created_at: string }[] || []).map((row) => ({
      id: String(row.id),
      actorId: row.actor_id,
      entityId: row.entity_id,
      action: row.action,
      summary: row.summary,
      createdAt: row.created_at,
    })));
    const taskIds = loadedTasks.map((task) => task.id);
    if (taskIds.length) {
      const dependencyResult = await supabase.from('task_dependencies').select('task_id, depends_on').in('task_id', taskIds);
      setDependencies(dependencyResult.error ? [] : (dependencyResult.data || []) as TaskDependency[]);
    } else {
      setDependencies([]);
    }
    let milestoneResult = await supabase.from('milestones').select('*').eq('group_id', id).order('sort_order').order('due_on');
    if (milestoneResult.error && /sort_order/.test(milestoneResult.error.message)) {
      milestoneResult = await supabase.from('milestones').select('*').eq('group_id', id).order('due_on');
    }
    const logResult = await supabase.from('progress_logs').select('*, profile:profiles(display_name)').eq('group_id', id).order('created_at', { ascending: false }).limit(20);
    setMilestones(milestoneResult.error ? [] : (milestoneResult.data || []) as Milestone[]);
    setLogs(logResult.error ? [] : (logResult.data || []) as ProgressLog[]);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  useEffect(() => {

    const channel = supabase
      .channel(`group-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `group_id=eq.${id}`,
        },
        () => void load()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `group_id=eq.${id}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, load]);

  useEffect(() => {
    if (!id || loading) return;
    let active = true;
    void loadInviteCode(String(id)).then((saved) => {
      if (!active || !saved) return;
      if (members.length > saved.members) {
        setInviteCode('');
        void clearInviteCode(String(id));
        return;
      }
      setInviteCode(saved.code);
    });
    return () => {
      active = false;
    };
  }, [id, loading, members.length]);

  const { refreshControl } = usePullRefresh(load);

  if (loading) {
    return <Loading />;
  }

  const projectTasks = tasks.map((task) => {
    const live = sharedTasks.find((item) => item.id === task.id);
    if (!live) return task;
    const updated = (live as Task & { updated_at?: string }).updated_at;
    return { ...task, status: live.status, skipped: live.skipped ?? task.skipped, series_id: live.series_id ?? task.series_id, ...(updated ? { updated_at: updated } : {}) };
  }).filter((task) => !task.skipped);
  const progressTasks = tasksForProgress(projectTasks);

  const myRole = members.find(
    member => member.user_id === user?.id
  )?.role;

  const canManage =
    myRole === 'owner' || myRole === 'admin';
  const progress = progressTasks.length ? completionPercent(progressTasks) : null;
  const openTasks = progressTasks.filter((task) => task.status !== 'completed');
  const now = new Date();
  const overdueTasks = openTasks.filter((task) => task.due_at && pickedInstant(task.due_at, timeZone) < now);
  const visibleTasks = projectTasks.filter((task) => (
    taskFilter === 'all' ? true : taskFilter === 'done' ? task.status === 'completed' : task.status !== 'completed'
  )).sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999') || a.title.localeCompare(b.title));
  const memberLabel = (userId: string | null) => members.find((member) => member.user_id === userId)?.profile?.display_name || 'Teammate';
  const today = zoneDayStamp(new Date(), timeZone);
  const todayLines = todayLinesFor(projectTasks, logs, today, timeZone);

  const saveProject = async () => {
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('groups').update({
      outcome: outcome.trim(),
      deadline: deadline ? formatDay(deadline) : null,
      priority,
    }).eq('id', id);
    setBusy(false);
    if (issue) setError(issue.message);
    else await load();
  };

  const addMilestone = async () => {
    const title = milestoneTitle.trim();
    if (!title) {
      setError('Name the milestone before saving it.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('milestones').insert({
      group_id: id,
      title,
      due_on: milestoneDate ? formatDay(milestoneDate) : null,
      description: '',
    });
    setBusy(false);
    if (issue) {
      setError(issue.message);
      return;
    }
    setMilestoneTitle('');
    setMilestoneDate(null);
    await load();
  };

  const moveMilestone = async (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= milestones.length) return;
    const current = milestones[index];
    const other = milestones[next];
    if (!current || !other) return;
    setError('');
    const first = await supabase.from('milestones').update({ sort_order: next }).eq('id', current.id);
    if (first.error) {
      setError(first.error.message.includes('sort_order')
        ? 'Run the latest SQL migration in Supabase, then try again.'
        : first.error.message);
      return;
    }
    const second = await supabase.from('milestones').update({ sort_order: index }).eq('id', other.id);
    if (second.error) setError(second.error.message);
    else await load();
  };

  const linkTask = async (taskId: string, milestoneId: string | null) => {
    setError('');
    const { error: issue } = await supabase.from('tasks').update({ milestone_id: milestoneId }).eq('id', taskId);
    if (issue) {
      setError(/milestone_id|schema cache|column/.test(issue.message)
        ? 'Run the latest SQL migration in Supabase, then try again.'
        : issue.message);
      return;
    }
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, milestone_id: milestoneId } : task)));
    await refresh();
  };

  const invite = async () => {
    setBusy(true);
    setError('');

    const { data, error: issue } = await supabase.rpc(
      'create_group_invitation',
      {
        target_group_id: id,
        valid_days: 14,
      }
    );

    setBusy(false);

    if (issue) {
      setError(issue.message);
    } else {
      const code = String(data ?? '');
      setInviteCode(code);
      if (code) await saveInviteCode(String(id), code, members.length);
    }
  };

  const memberAction = (member: Membership) => {
    const options: {
      text: string;
      onPress: () => void;
    }[] = [];

    if (
      myRole === 'owner' &&
      member.role === 'member'
    ) {
      options.push({
        text: 'Make admin',
        onPress: () =>
          void manage(member.user_id, 'admin'),
      });
    }

    if (
      canManage &&
      member.user_id !== user?.id &&
      member.role !== 'owner'
    ) {
      options.push({
        text: 'Remove from project',
        onPress: () =>
          Alert.alert(
            'Remove member?',
            'They will lose access to this project.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () =>
                  void manage(member.user_id, 'remove'),
              },
            ]
          ),
      });
    }

    if (member.user_id === user?.id) {
      options.push({
        text: 'Leave project',
        onPress: () =>
          Alert.alert(
            'Leave this project?',
            'You will lose access to its shared work.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Leave',
                style: 'destructive',
                onPress: () =>
                  void manage(member.user_id, 'remove'),
              },
            ]
          ),
      });
    }

    if (!options.length) {
      return;
    }

    Alert.alert(
      member.profile?.display_name || 'Member',
      undefined,
      [
        ...options,
        {
          text: 'Cancel',
          onPress: () => {},
        },
      ]
    );
  };

  const manage = async (
    memberId: string,
    action: 'admin' | 'remove'
  ) => {
    const { error: issue } = await supabase.rpc(
      'manage_group_member',
      {
        target_group_id: id,
        target_user_id: memberId,
        action,
      }
    );

    if (issue) {
      setError(issue.message);
    } else if (memberId === user?.id) {
      router.replace('/(tabs)/groups');
    } else {
      await load();
    }
  };

  return (
    <Page>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: group?.color || colors.primary }]} />
            <Text style={styles.projectName} numberOfLines={2}>{group?.name || 'Project'}</Text>
            {group?.status ? <Pill tone={group.status === 'archived' ? 'blocked' : 'active'}>{group.status}</Pill> : null}
          </View>
          {group?.description ? <Text style={styles.description} numberOfLines={2}>{group.description}</Text> : null}
          <Text style={styles.metaLine}>
            {group?.deadline ? `Deadline ${formatDate(group.deadline)}` : 'No deadline'}
          </Text>
        </View>

        <View style={styles.tabs}>
          {SECTIONS.map((item) => {
            const selected = section === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  easeLayout(reduceMotion);
                  setSection(item.id);
                }}
                style={[styles.tab, selected && styles.tabOn]}
              >
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.tabLabel, selected && styles.tabLabelOn]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={refreshControl}
        style={{ flex: 1 }}
      >

        {section === 'overview' ? (
        <>
        <Text style={styles.heading}>{group?.outcome?.trim() || 'No outcome written yet.'}</Text>
        {progress === null ? (
          <Text style={styles.metaLine}>No tasks yet, so there is no completion percent.</Text>
        ) : (
          <ProgressBar value={progress} color={group?.color || colors.primary} label={`${progress}% of ${projectTasks.length} tasks finished · ${openTasks.length} still open${overdueTasks.length ? ` · ${overdueTasks.length} overdue` : ''}`} />
        )}
        <Text style={styles.subhead}>Today</Text>
        {todayLines.length ? todayLines.map((line) => (
          <Text key={line.id} style={styles.metaLine}>{line.text}</Text>
        )) : (
          <Text style={styles.metaLine}>No one has posted today.</Text>
        )}
        <Button title="Post an update" onPress={() => router.push({ pathname: '/progress', params: { groupId: id } })} secondary />
        <View style={styles.section}>
          <Text style={styles.heading}>People <Text style={styles.count}>{members.length}</Text></Text>
        </View>

        {members.map(member => (
          <Card
            key={member.user_id}
            style={styles.member}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={member.user_id === user?.id ? 'Your profile' : `${member.profile?.display_name || 'Teammate'} availability`}
              onPress={() => {
                const personName = member.profile?.display_name || 'Teammate';
                if (member.user_id === user?.id) {
                  router.push('/profile');
                  return;
                }
                router.push(`/member/${member.user_id}?name=${encodeURIComponent(personName)}`);
              }}
              style={styles.person}
            >
              <View pointerEvents="none" style={styles.personBody}>
                {member.profile?.avatar_url ? (
                  <Image
                    source={{ uri: member.profile.avatar_url }}
                    style={styles.initial}
                    onError={() => {
                      console.log("Failed to load avatar:", member.profile?.avatar_url);
                    }}
                  />
                ) : (
                  <View style={styles.memberAvatarFallback}>
                    <Text style={styles.memberAvatarText}>
                      {member.profile?.display_name?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.personName}>
                    {member.profile?.display_name || 'Unnamed teammate'}
                  </Text>
                  <Text style={styles.personRole}>
                    {member.role}
                  </Text>
                </View>
              </View>
            </Pressable>

            <Text
              onPress={() => memberAction(member)}
              style={styles.more}
            >
              {(canManage && member.user_id !== user?.id) ||
              member.user_id === user?.id
                ? '•••'
                : ''}
            </Text>
          </Card>
        ))}

        {canManage ? (
          <Card style={styles.invite}>
            <Text style={styles.heading}>
              Invite teammates
            </Text>

            <Text style={styles.muted}>
              {inviteCode
                ? 'This code stays here until someone joins. It works once and expires in 14 days.'
                : 'Create a single-use code that expires in 14 days.'}
            </Text>

            <Button
              title={
                busy
                  ? 'Creating code…'
                  : 'Create invitation code'
              }
              onPress={() => void invite()}
              secondary
              disabled={busy}
            />

            {inviteCode ? (
              <Text
                selectable
                style={styles.code}
              >
                {inviteCode}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {section === 'overview' && canManage ? (
          <Card>
            <Text style={styles.heading}>Project settings</Text>
            <Field label="Intended outcome" value={outcome} onChangeText={setOutcome} multiline placeholder="What does done look like?" />
            <DateField label="Deadline" value={deadline} onChange={setDeadline} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {(['low', 'medium', 'high'] as const).map((value) => (
                <Chip key={value} label={value} active={priority === value} onPress={() => setPriority(value)} />
              ))}
            </View>
            <Button title={busy ? 'Saving…' : 'Save project'} onPress={() => void saveProject()} disabled={busy} secondary />
          </Card>
        ) : null}

        {section === 'overview' ? (
          <Card>
            <Text style={styles.heading}>Plan and adjust</Text>
            <Button title="Ask Syncro" onPress={() => router.push({ pathname: '/assistant', params: { q: `Revise the plan for ${group?.name || 'this project'}`, groupId: id } })} />
            <Button title="Propose a reschedule" onPress={() => router.push({ pathname: '/reschedule', params: { groupId: id } })} secondary />
            <Button title="Post a progress log" onPress={() => router.push({ pathname: '/progress', params: { groupId: id } })} secondary />
            {myRole === 'owner' ? (
              <Button
                title={group?.status === 'archived' ? 'Archived' : 'Archive project'}
                disabled={busy || group?.status === 'archived'}
                secondary
                onPress={() => {
                  Alert.alert('Archive this project?', 'Members keep their history, and the project leaves the active list.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Archive', style: 'destructive', onPress: () => void (async () => {
                      const { error: issue } = await supabase.from('groups').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', id);
                      if (issue) setError(issue.message);
                      else await load();
                    })() },
                  ]);
                }}
              />
            ) : null}
            {myRole === 'owner' ? (
              <Button
                title="Delete project"
                danger
                disabled={busy}
                onPress={() => {
                  Alert.alert('Delete this project?', 'This removes the project and its tasks, meetings, and progress. This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
                      const { data, error: issue } = await supabase.from('groups').delete().eq('id', id).select('id');
                      if (issue) setError(issue.message);
                      else if (!data?.length) setError('The project was not deleted.');
                      else {
                        await refreshWorkspace();
                        router.replace('/(tabs)/groups');
                      }
                    })() },
                  ]);
                }}
              />
            ) : null}
          </Card>
        ) : null}
        </>
        ) : null}

        {section === 'overview' ? (
        <>
        <View style={styles.section}>
          <Text style={styles.heading}>
            Upcoming calendar
          </Text>

          <Text
            onPress={() => router.push({ pathname: '/create-event', params: { groupId: String(id) } })}
            style={styles.link}
          >
            ＋ Add
          </Text>
        </View>

        {events.filter((event) => event.kind === 'deadline' || pickedInstant(event.ends_at, timeZone) > now).length ? (
          events.filter((event) => event.kind === 'deadline' || pickedInstant(event.ends_at, timeZone) > now).map(event => (
            <Card
              key={event.id}
              style={styles.item}
            >
              <Text
                onPress={() =>
                  router.push(`/event/${event.id}`)
                }
                style={styles.itemTitle}
              >
                {event.title}
              </Text>

              <Text
                onPress={() =>
                  router.push(`/event/${event.id}`)
                }
                style={styles.muted}
              >
                {formatDate(event.starts_at, { timeZone: 'UTC' })} ·{' '}
                {formatClockFace(event.starts_at)}
                {event.location
                  ? ` · ${event.location}`
                  : ''}
              </Text>

              <View style={{ marginTop: 8 }}>
                <Pill>{event.kind}</Pill>
              </View>
            </Card>
          ))
        ) : (
          <EmptyState
            title="Nothing coming up"
            body="Add a meeting or deadline and it will show up here."
          />
        )}

        </>
        ) : null}

        {section === 'milestones' ? (
          <>
            <Text style={styles.heading}>Milestones</Text>
            {milestones.length ? milestones.map((milestone, index) => {
              const linked = projectTasks.filter((task) => task.milestone_id === milestone.id);
              const stats = milestoneTaskProgress(linked);
              const open = openMilestoneId === milestone.id;
              const dueDay = milestone.due_on ? parseDay(milestone.due_on) : null;
              const milestoneState = milestone.completed_at ? 'Done' : dueDay && dueDay < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? 'Overdue' : 'Upcoming';
              return (
              <Card key={milestone.id}>
                <Text
                  accessibilityRole="button"
                  style={styles.itemTitle}
                  onPress={() => {
                    easeLayout(reduceMotion);
                    setOpenMilestoneId(open ? null : milestone.id);
                  }}
                >
                  {open ? '▾' : '▸'} {milestone.title}
                </Text>
                <Text style={styles.muted}>
                  {milestoneState}
                  {' · '}{milestone.due_on ? formatDate(milestone.due_on) : 'No date'}
                  {stats.total ? ` · ${stats.done} of ${stats.total} tasks finished` : ' · no tasks linked yet'}
                </Text>
                {stats.total ? <ProgressBar value={stats.percent} color={group?.color || colors.primary} /> : null}
                {open ? (
                  <>
                    {linked.map((task) => (
                      <Text key={task.id} style={styles.link} onPress={() => router.push(`/task/${task.id}`)}>
                        {taskStatusLabel(task.status)} · {task.title}
                      </Text>
                    ))}
                    <Text style={styles.muted}>
                      {projectTasks.length ? 'Tap a task to link it here. Tap it again to unlink it. A task can belong to one milestone.' : 'Add a task, then link it here.'}
                    </Text>
                    {projectTasks.length ? (
                      <View style={styles.taskChoices}>
                        {projectTasks.map((task) => (
                          <Chip
                            key={task.id}
                            label={task.title}
                            active={task.milestone_id === milestone.id}
                            onPress={() => void linkTask(task.id, task.milestone_id === milestone.id ? null : milestone.id)}
                          />
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.section}>
                      {index > 0 ? <Text style={styles.link} onPress={() => void moveMilestone(index, -1)}>Move up</Text> : <Text />}
                      {index < milestones.length - 1 ? <Text style={styles.link} onPress={() => void moveMilestone(index, 1)}>Move down</Text> : null}
                    </View>
                  </>
                ) : (
                  <Text style={styles.link} onPress={() => {
                    easeLayout(reduceMotion);
                    setOpenMilestoneId(milestone.id);
                  }}>Show tasks and actions</Text>
                )}
              </Card>
              );
            }) : <EmptyState title="No milestones yet" body="Add a checkpoint when the project has a meaningful stage. Tasks stay even if you delete a milestone later. Project progress counts finished tasks only." />}
            <Field label="Milestone" value={milestoneTitle} onChangeText={setMilestoneTitle} placeholder="e.g. Working prototype" maxLength={140} />
            <DateField label="Target date" value={milestoneDate} onChange={setMilestoneDate} />
            <Button title="Add milestone" onPress={() => void addMilestone()} busy={busy} secondary />
          </>
        ) : null}

        {section === 'tasks' ? (
        <>
        <View style={styles.filters}>
          {(['open', 'done', 'all'] as const).map((value) => (
            <Chip key={value} label={value === 'open' ? 'Open' : value === 'done' ? 'Finished' : 'All'} active={taskFilter === value} onPress={() => setTaskFilter(value)} />
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>
            Project tasks
          </Text>

          <Text
            onPress={() => router.push({ pathname: '/create-task', params: { groupId: String(id) } })}
            style={styles.link}
          >
            ＋ Add
          </Text>
        </View>

        {visibleTasks.length ? (
          visibleTasks.map(task => { 
            const overdue = task.status !== 'completed' && Boolean(task.due_at) && pickedInstant(task.due_at || '', timeZone) < now;
            const milestoneTitle = task.milestone_id ? milestones.find((item) => item.id === task.milestone_id)?.title : '';
            return (
            <Card
              key={task.id}
              style={styles.taskRow}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: pendingTaskId === task.id, checked: task.status === 'completed' }}
                accessibilityLabel={task.status === 'completed' ? 'Mark not finished' : 'Mark finished'}
                disabled={pendingTaskId === task.id}
                onPress={() => toggleFinished(task.id, task.status)}
                hitSlop={6}
                style={({ pressed }) => [styles.check, pressed && styles.checkPressed]}
              >
                <View style={[styles.mark, task.status === 'completed' && styles.markOn, pendingTaskId === task.id && styles.markBusy]}>
                  {task.status === 'completed' ? <Ionicons name="checkmark" size={15} color={colors.primaryForeground} /> : null}
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={task.title}
                onPress={() => router.push(`/task/${task.id}`)}
                style={styles.taskBody}
              >
                <Text style={[styles.itemTitle, task.status === 'completed' && styles.taskDone]}>
                  {task.title}
                </Text>
                <Text style={styles.muted}>
                  {assigneeLabel(task)} · {task.due_at ? formatDate(task.due_at, { timeZone }) : 'No due date'}
                  {overdue ? ' · Overdue' : ''}
                  {milestoneTitle ? ` · ${milestoneTitle}` : ''}
                </Text>
                <View style={styles.taskPills}>
                  <Pill tone={priorityTone(task.priority)}>{task.priority}</Pill>
                  <Pill tone={task.status === 'completed' ? 'done' : task.status === 'blocked' ? 'blocked' : 'neutral'}>{taskStatusLabel(task.status)}</Pill>
                </View>
              </Pressable>
            </Card>
            );
          })
        ) : (
          <EmptyState
            title="No tasks yet"
            body="Capture the work your team needs to finish."
          />
        )}

        </>
        ) : null}

        {section === 'timeline' ? (
          <ProjectTimeline tasks={projectTasks} milestones={milestones} events={events} dependencies={dependencies} timeZone={timeZone} />
        ) : null}

        {section === 'activity' ? (
          <>
            <Button title="Post a progress log" onPress={() => router.push({ pathname: '/progress', params: { groupId: id } })} />
            {logs.length ? (
              <>
                <Text style={styles.subhead}>Progress logs</Text>
                {logs.slice(0, 5).map((log) => (
                  <View key={log.id} style={styles.activityRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{log.profile?.display_name || 'Teammate'}</Text>
                      <Text style={styles.muted} numberOfLines={2}>{log.accomplishments}</Text>
                    </View>
                    <Text style={styles.metaLine}>{formatDate(log.log_date)}</Text>
                  </View>
                ))}
              </>
            ) : null}
            <Text style={styles.subhead}>Recent changes</Text>
            {latestChanges(activity).length ? latestChanges(activity).map((item) => (
              <View key={item.id} style={styles.activityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.summary.replace(/^(Task|Event|Meeting):\s*/i, '')}</Text>
                  <Text style={styles.metaLine}>{memberLabel(item.actorId)} · {item.action === 'insert' ? 'Added' : item.action === 'delete' ? 'Removed' : 'Updated'}</Text>
                </View>
                <Text style={styles.metaLine}>{formatDate(item.createdAt)}</Text>
              </View>
            )) : <EmptyState compact title="No recent changes" body="New tasks and meetings show up here once, not every time they are saved." />}
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}

function zoneDayStamp(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : '';
}

function onZoneDay(value: string | null | undefined, stamp: string, timeZone: string) {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === stamp;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return zoneDayStamp(date, timeZone) === stamp;
}

function todayLinesFor(tasks: Task[], logs: ProgressLog[], stamp: string, timeZone: string) {
  const lines: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const updated = (task as Task & { updated_at?: string }).updated_at;
    if (task.status !== 'completed' || !onZoneDay(updated, stamp, timeZone)) continue;
    const who = assigneeLabel(task);
    const person = who === 'Unassigned' ? 'Someone' : who;
    if (seen.has(person)) continue;
    seen.add(person);
    lines.push({ id: `done-${task.id}`, text: `${person} finished ${task.title}` });
  }
  for (const log of logs) {
    if (!onZoneDay(log.log_date, stamp, timeZone)) continue;
    const person = log.profile?.display_name || 'Teammate';
    if (seen.has(person)) continue;
    seen.add(person);
    lines.push({ id: `log-${log.id}`, text: `${person} · ${log.accomplishments}` });
  }
  return lines;
}

function assigneeLabel(task: Task) {
  const names = (task.assignments ?? [])
    .map((assignment) => assignment.profile?.display_name?.trim())
    .filter((name): name is string => Boolean(name));
  if (!names.length) return 'Unassigned';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
}

function ProjectTimeline({
  tasks,
  milestones,
  events,
  dependencies,
  timeZone,
}: {
  tasks: Task[];
  milestones: Milestone[];
  events: CalendarEvent[];
  dependencies: TaskDependency[];
  timeZone: string;
}) {
  const { colors } = useTheme();
  const rows = [
    ...milestones.filter((milestone) => milestone.due_on).map((milestone) => ({
      key: `milestone-${milestone.id}`,
      at: milestone.due_on || '',
      kind: 'Milestone',
      title: milestone.title,
      href: '',
      overdue: !milestone.completed_at && Boolean(milestone.due_on) && (milestone.due_on || '') < zoneDayStamp(new Date(), timeZone),
      note: milestone.completed_at ? 'Done' : '',
    })),
    ...tasks.filter((task) => task.due_at).map((task) => {
      const after = dependencies
        .filter((item) => item.task_id === task.id)
        .map((item) => tasks.find((candidate) => candidate.id === item.depends_on)?.title)
        .filter((title): title is string => Boolean(title));
      return {
        key: `task-${task.id}`,
        at: task.due_at || '',
        kind: 'Task',
        title: task.title,
        href: `/task/${task.id}`,
        overdue: task.status !== 'completed' && pickedInstant(task.due_at || '', timeZone) < new Date(),
        note: after.length ? `After ${after.join(', ')}` : '',
      };
    }),
    ...events.map((event) => ({
      key: `event-${event.id}`,
      at: event.starts_at,
      kind: event.kind === 'meeting' ? 'Meeting' : event.kind === 'deadline' ? 'Deadline' : 'Event',
      title: event.title,
      href: `/event/${event.id}`,
      overdue: new Date(event.ends_at) < new Date(),
      note: '',
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (!rows.length) {
    return <EmptyState compact title="Nothing dated yet" body="Milestones, task due dates, and meetings appear here in order." />;
  }

  return (
    <View>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          accessibilityRole={row.href ? 'button' : undefined}
          disabled={!row.href}
          onPress={() => {
            if (row.key.startsWith('task-')) router.push(`/task/${row.key.slice(5)}`);
            if (row.key.startsWith('event-')) router.push(`/event/${row.key.slice(6)}`);
          }}
          style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{formatDate(row.at, { timeZone })} · {row.kind}{row.overdue ? ' · Overdue' : ''}{row.note ? ` · ${row.note}` : ''}</Text>
          <Text style={{ color: row.overdue ? colors.danger : colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 }}>{row.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return {
  header: { marginTop: 4, marginBottom: 12, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  projectName: { flex: 1, color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  metaLine: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: 'row', backgroundColor: colors.mutedSurface, borderRadius: 12, padding: 3, marginBottom: 14 },
  tab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 2 },
  tabOn: { backgroundColor: colors.surface },
  tabLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  tabLabelOn: { color: colors.text },
  subhead: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  taskPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  groupHero: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'flex-start',
    marginTop: 4,
  },
  color: {
    width: 12,
    height: 46,
    borderRadius: 8,
  },
  sections: {
    gap: 8,
    alignItems: 'center',
    paddingRight: 8,
  },
  progress: {
    marginBottom: 14,
  },
  sectionScroll: {
    height: 48,
    marginBottom: 8,
    flexGrow: 0,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
  },
  taskChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  heading: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  count: {
    color: colors.primary,
    fontSize: 13,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  person: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  personBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  initial: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.mint
  },
  memberAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center'
  },
  memberAvatarText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800'
  },
  personName: {
    color: colors.ink,
    fontWeight: '700',
  },
  personRole: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
    textTransform: 'capitalize',
  },
  more: {
    color: colors.muted,
    fontWeight: '900',
    padding: 8,
  },
  invite: {
    marginTop: 7,
  },
  muted: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 5,
  },
  code: {
    color: colors.primaryDark,
    backgroundColor: colors.mint,
    padding: 12,
    borderRadius: 10,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 12,
  },
  link: {
    color: colors.primary,
    fontWeight: '800',
  },
  item: {
    paddingVertical: 13,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 10,
    paddingLeft: 4,
    paddingRight: 14,
  },
  taskBody: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 4,
  },
  taskDone: {
    color: colors.muted,
  },
  check: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPressed: {
    opacity: 0.7,
  },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  markOn: {
    backgroundColor: colors.primary,
  },
  markBusy: {
    opacity: 0.45,
  },
  itemTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
} as const;
}

