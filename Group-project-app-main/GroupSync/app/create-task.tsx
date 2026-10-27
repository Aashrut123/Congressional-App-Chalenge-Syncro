import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import { RecurrenceField } from '@/components/RecurrenceField';
import {
  Button,
  Card,
  Chip,
  ErrorText,
  Field,
  Page,
} from '@/components/ui';

import { useAuth } from '@/features/auth/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { encodeWallClock, personName } from '@/lib/format';
import { calendarStamp, parseRule, validateRule, type RecurrenceRule } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

import type {
  Group,
  Membership,
  Milestone,
  TaskPriority,
} from '@/types/database';

const priorities: TaskPriority[] = ['low', 'medium', 'high'];

function dueOnDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 17, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function CreateTaskScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user } = useAuth();
  const { groups, refresh } = useWorkspace();
  const params = useLocalSearchParams<{ groupId?: string | string[]; day?: string | string[] }>();
  const openedFrom = Array.isArray(params.groupId) ? params.groupId[0] ?? '' : params.groupId ?? '';
  const openedDay = Array.isArray(params.day) ? params.day[0] ?? '' : params.day ?? '';

  const [groupId, setGroupId] = useState(openedFrom);
  const [members, setMembers] = useState<Membership[]>([]);
  const [milestones, setMilestones] = useState<Pick<Milestone, 'id' | 'title'>[]>([]);
  const [milestoneId, setMilestoneId] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState<Date | null>(dueOnDay(openedDay));
  const [estimate, setEstimate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!groupId) return;

    let active = true;
    supabase
      .from('group_memberships')
      .select('*, profile:profiles(id,display_name)')
      .eq('group_id', groupId)
      .then(({ data }) => {
        if (active) setMembers((data || []) as Membership[]);
      });
    supabase
      .from('milestones')
      .select('id,title')
      .eq('group_id', groupId)
      .order('sort_order')
      .order('title')
      .then(({ data, error: issue }) => {
        if (!active) return;
        if (issue) {
          supabase
            .from('milestones')
            .select('id,title')
            .eq('group_id', groupId)
            .order('title')
            .then((fallback) => {
              if (active) setMilestones((fallback.data || []) as Pick<Milestone, 'id' | 'title'>[]);
            });
          return;
        }
        setMilestones((data || []) as Pick<Milestone, 'id' | 'title'>[]);
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  const teammates = members.filter((member) => member.user_id !== user?.id);

  const chooseGroup = (nextId: string) => {
    const selected = nextId && groupId !== nextId ? nextId : '';
    setGroupId(selected);
    setAssignees([]);
    setMilestoneId('');
    if (!selected) {
      setMembers([]);
      setMilestones([]);
    }
  };

  const create = async () => {
    if (!title.trim()) {
      setError('Add a task title.');
      return;
    }

    const savedRule = recurrence && due ? { ...recurrence, anchor: calendarStamp(due) } : recurrence;
    if (savedRule && !due) {
      setError('Add a due date to repeat this task.');
      return;
    }
    const recurrenceError = savedRule ? validateRule(savedRule) : '';
    if (recurrenceError) {
      setError(recurrenceError);
      return;
    }

    const estimatedMinutes = estimate.trim() ? Number(estimate) : null;
    if (estimatedMinutes != null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
      setError('Estimated minutes must be a whole number greater than 0.');
      return;
    }

    setBusy(true);
    setError('');

    const { data: task, error: issue } = await supabase
      .from('tasks')
      .insert({
        group_id: groupId || null,
        title: title.trim(),
        description: description.trim(),
        due_at: due ? encodeWallClock(due) : null,
        estimated_minutes: estimatedMinutes,
        priority,
        milestone_id: groupId && milestoneId ? milestoneId : null,
      })
      .select('id')
      .single();

    if (issue || !task) {
      setBusy(false);
      setError(
        issue && /milestone_id|schema cache|column|group_id|not-null|null value|row-level security|recurrence|series_id/i.test(issue.message)
          ? 'Run the latest SQL migration in Supabase, then try again.'
          : issue?.message || 'Could not create task.',
      );
      return;
    }

    if (savedRule) {
      const saved = parseRule(savedRule);
      const linked = await supabase.from('tasks').update({
        series_id: task.id,
        recurrence: saved,
        occurrence_index: 0,
        skipped: false,
      }).eq('id', task.id);
      if (linked.error) {
        setBusy(false);
        setError(
          /recurrence|series_id|schema cache|column/i.test(linked.error.message)
            ? 'Task saved, but repeating needs the latest SQL migration in Supabase.'
            : `Task saved, but repeating failed: ${linked.error.message}`,
        );
        await refresh();
        return;
      }
    }

    const assigneeIds = teammates.length ? assignees : user ? [user.id] : [];
    if (assigneeIds.length) {
      const { error: assignmentIssue } = await supabase
        .from('task_assignments')
        .insert(assigneeIds.map((userId) => ({ task_id: task.id, user_id: userId })));

      if (assignmentIssue) {
        setError(
          `Task saved, but assignment failed: ${assignmentIssue.message}`
        );
      }
    }

    setBusy(false);
    await refresh();
    router.back();
  };

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        <Field
          label="Task title"
          placeholder="What needs to get done?"
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Group</Text>
        <Text style={styles.hint}>Optional. Tap a project to attach this task, then tap it again to leave the task personal.</Text>

        <Card style={styles.choices}>
          <Text
            onPress={() => chooseGroup('')}
            style={[
              styles.choice,
              !groupId && styles.active,
            ]}
          >
            None
          </Text>
          {groups.map((group: Group) => (
            <Text
              key={group.id}
              onPress={() => chooseGroup(group.id)}
              style={[
                styles.choice,
                groupId === group.id && styles.active,
              ]}
            >
              {group.name}
            </Text>
          ))}
        </Card>

        <Field
          label="Description"
          placeholder="Context, links or instructions"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <DateField label="Due" mode="datetime" value={due} onChange={setDue} />
        <RecurrenceField due={due} rule={recurrence} onChange={setRecurrence} />

        <Field
          label="Estimated minutes"
          placeholder="Optional, such as 90"
          value={estimate}
          onChangeText={setEstimate}
          keyboardType="number-pad"
        />

        {groupId ? (
          <>
            <Text style={styles.label}>Milestone</Text>
            <Text style={styles.hint}>Optional. The task stays if this milestone is removed later.</Text>
            {milestones.length ? (
              <Card style={styles.choices}>
                <Chip label="None" active={!milestoneId} onPress={() => setMilestoneId('')} />
                {milestones.map((milestone) => (
                  <Chip
                    key={milestone.id}
                    label={milestone.title}
                    active={milestoneId === milestone.id}
                    onPress={() => setMilestoneId(milestone.id)}
                  />
                ))}
              </Card>
            ) : (
              <Text style={styles.hint}>This project has no milestones yet. Add one from the project timeline, then attach the task.</Text>
            )}
          </>
        ) : null}

        <Text style={styles.label}>Priority</Text>

        <Card style={styles.choices}>
          {priorities.map(value => (
            <Text
              key={value}
              onPress={() => setPriority(value)}
              style={[
                styles.choice,
                priority === value && styles.active,
              ]}
            >
              {value}
            </Text>
          ))}
        </Card>

        {teammates.length ? (
          <>
            <Text style={styles.label}>
              Assign to teammates
            </Text>
            <Text style={styles.hint}>Select everyone sharing this task. Leave them all off to keep it unassigned.</Text>

            <Card style={styles.choices}>
              <Text
                onPress={() => setAssignees([])}
                style={[
                  styles.choice,
                  assignees.length === 0 && styles.active,
                ]}
              >
                Unassigned
              </Text>

              {members.map(member => (
                <Text
                  key={member.user_id}
                  onPress={() => setAssignees((current) => current.includes(member.user_id) ? current.filter((id) => id !== member.user_id) : [...current, member.user_id])}
                  style={[
                    styles.choice,
                    assignees.includes(member.user_id) && styles.active,
                  ]}
                >
                  {personName(member.profile, member.role)}
                </Text>
              ))}
            </Card>
          </>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button
          title={busy ? 'Saving…' : 'Create task'}
          onPress={() => void create()}
          disabled={busy}
        />
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 4,
  },

  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },

  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    padding: 10,
  },

  choice: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  active: {
    color: 'white',
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
} as const;
}
