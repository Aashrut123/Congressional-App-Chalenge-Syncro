import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import { Button, Card, Chip, ErrorText, Field, Page, Pill } from '@/components/ui';
import { useWorkspace } from '@/hooks/useWorkspace';
import { encodeWallClock } from '@/lib/format';
import { formatDay, parseDay, todayDay } from '@/lib/planner/dates';
import { acceptedChanges, proposeReschedule } from '@/lib/planner/reschedule';
import type { PlannerMember, RescheduleProposal, RescheduleTask } from '@/lib/planner/types';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type { Membership, TaskDependency, UnavailablePeriod } from '@/types/database';

export default function RescheduleScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ groupId?: string }>();
  const { groups, tasks, refresh } = useWorkspace();
  const [groupId, setGroupId] = useState(params.groupId ?? '');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<RescheduleProposal | null>(null);
  const [sourceTasks, setSourceTasks] = useState<RescheduleTask[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const preview = async () => {
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      setError('Choose a project.');
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    try {
      const groupTasks = tasks.filter((task) => task.group_id === groupId);
      const ids = groupTasks.map((task) => task.id);
      const dependencyResult = ids.length
        ? await supabase.from('task_dependencies').select('task_id,depends_on').in('task_id', ids)
        : { data: [], error: null };
      if (dependencyResult.error) throw new Error(dependencyResult.error.message);
      const links = (dependencyResult.data ?? []) as TaskDependency[];
      const mapped: RescheduleTask[] = groupTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.due_at ? task.due_at.slice(0, 10) : null,
        assigneeId: task.assignments?.[0]?.user_id ?? null,
        estimatedMinutes: task.estimated_minutes ?? 60,
        dependsOn: links.filter((link) => link.task_id === task.id).map((link) => link.depends_on),
      }));
      const memberships = await supabase.from('group_memberships').select('*, profile:profiles(id,display_name,skills)').eq('group_id', groupId);
      if (memberships.error) throw new Error(memberships.error.message);
      const members = (memberships.data ?? []) as Membership[];
      const memberIds = members.map((member) => member.user_id);
      const away = memberIds.length
        ? await supabase.from('unavailable_periods').select('*').in('user_id', memberIds)
        : { data: [], error: null };
      const windows = memberIds.length
        ? await supabase.from('availability_windows').select('user_id,weekday').in('user_id', memberIds)
        : { data: [], error: null };
      const plannerMembers: PlannerMember[] = members.map((member) => ({
        id: member.user_id,
        name: member.profile?.display_name || 'Teammate',
        skills: member.profile?.skills || '',
        weeklyHours: 6,
        availableWeekdays: [...new Set(((windows.data ?? []) as { user_id: string; weekday: number }[]).filter((row) => row.user_id === member.user_id).map((row) => row.weekday))],
        unavailable: ((away.data ?? []) as UnavailablePeriod[]).filter((row) => row.user_id === member.user_id).map((row) => ({ start: row.starts_on, end: row.ends_on })),
      }));
      const nextDeadline = deadline ? formatDay(deadline) : group.deadline || '';
      const next = proposeReschedule({
        tasks: mapped,
        members: plannerMembers,
        startDate: group.starts_on || todayDay(),
        deadline: nextDeadline,
        reason,
      });
      setSourceTasks(mapped);
      setProposal(next);
      setAccepted(next.changes.map((change) => change.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build a proposal.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    const updates = acceptedChanges(proposal, sourceTasks, accepted);
    if (!updates.length) {
      setNote('Nothing was changed.');
      return;
    }
    setBusy(true);
    setError('');
    for (const update of updates) {
      const { error: issue } = await supabase.from('tasks').update({
        due_at: encodeWallClock(new Date(`${update.dueDate}T17:00:00`)),
      }).eq('id', update.id);
      if (issue) {
        setBusy(false);
        setError(issue.message);
        return;
      }
    }
    setBusy(false);
    await refresh();
    setNote(`Updated ${updates.length} deadline${updates.length === 1 ? '' : 's'}. Completed tasks and calendar events were left alone.`);
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
        <Text style={styles.lead}>Preview a new set of task deadlines. Nothing moves until you accept it.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {groups.filter((group) => group.status !== 'archived').map((group) => (
            <Chip key={group.id} label={group.name} active={group.id === groupId} onPress={() => { setGroupId(group.id); setDeadline(group.deadline ? parseDay(group.deadline) : null); }} />
          ))}
        </ScrollView>
        <DateField label="Deadline to plan against" value={deadline} onChange={setDeadline} />
        <Field label="What changed" value={reason} onChangeText={setReason} placeholder="A teammate is unavailable, or the deadline moved" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button title={busy ? 'Working…' : 'Preview changes'} onPress={() => void preview()} disabled={busy} />
        {proposal ? (
          <Card>
            <Pill color={proposal.feasible ? colors.mint : colors.dangerBg}>{proposal.feasible ? 'Feasible' : 'Does not fit'}</Pill>
            <Text style={styles.body}>{proposal.explanation}</Text>
            {proposal.tradeoffs.map((item) => <Text key={item} style={styles.note}>{item}</Text>)}
            {proposal.unchangedCompleted.length ? <Text style={styles.note}>Completed and unchanged: {proposal.unchangedCompleted.join(', ')}</Text> : null}
            {proposal.changes.map((change) => (
              <Card key={change.id}>
                <Text style={styles.item}>{change.title}</Text>
                <Text style={styles.note}>{change.from ?? 'No date'} → {change.to}</Text>
                <Text style={styles.note}>{change.reason}</Text>
                <Chip
                  label={accepted.includes(change.id) ? 'Will apply' : 'Leave unchanged'}
                  active={accepted.includes(change.id)}
                  onPress={() => setAccepted((current) => current.includes(change.id) ? current.filter((id) => id !== change.id) : [...current, change.id])}
                />
              </Card>
            ))}
            <Button title={busy ? 'Applying…' : 'Apply accepted deadlines'} onPress={() => void apply()} disabled={busy || !proposal.changes.length} />
          </Card>
        ) : null}
        {note ? <Text style={styles.body}>{note}</Text> : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  lead: { color: colors.muted, lineHeight: 20, marginBottom: 12 },
  row: { gap: 8, paddingBottom: 12 },
  body: { color: colors.ink, marginTop: 8, lineHeight: 20 },
  note: { color: colors.muted, marginTop: 6, lineHeight: 18, fontSize: 13 },
  item: { color: colors.ink, fontWeight: '800' as const },
} as const;
}

