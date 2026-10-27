import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

import { DateField } from '@/components/DateField';
import { RecurrenceField } from '@/components/RecurrenceField';
import {
  Button,
  Card,
  Chip,
  ErrorText,
  Field,
  Loading,
  Page,
  Pill,
} from '@/components/ui';

import { useAuth } from '@/features/auth/AuthProvider';
import { refreshWorkspace, stopRecurringTask, updateTaskStatus } from '@/hooks/useWorkspace';
import { decodeWallClock, encodeWallClock, formatDate, personName } from '@/lib/format';
import { calendarStamp, parseRule, ruleSummary, validateRule, type RecurrenceRule } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

function taskDraft(value: {
  title: string;
  description: string;
  due: Date | null;
  estimated: string;
  recurrence: RecurrenceRule | null;
}) {
  const rule = value.recurrence && value.due ? { ...value.recurrence, anchor: calendarStamp(value.due) } : null;
  return JSON.stringify({
    title: value.title.trim(),
    description: value.description.trim(),
    due: value.due ? encodeWallClock(value.due) : null,
    estimated: value.estimated.trim(),
    recurrence: rule,
  });
}

import type {
  Comment,
  Milestone,
  Task,
  TaskStatus,
} from '@/types/database';

export default function TaskDetailScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [due, setDue] = useState<Date | null>(null);
  const [estimated, setEstimated] = useState('');
  const [members, setMembers] = useState<{ user_id: string; name: string; role?: string }[]>([]);
  const [milestones, setMilestones] = useState<Pick<Milestone, 'id' | 'title'>[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [editScope, setEditScope] = useState<'this' | 'future' | 'series'>('this');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const savedDraft = useRef('');
  const saveSeq = useRef(0);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([
      supabase
        .from('tasks')
        .select(
          '*, group:groups(id,name,color), assignments:task_assignments(user_id, profile:profiles(display_name))'
        )
        .eq('id', id)
        .single(),

      supabase
        .from('task_comments')
        .select('*, profile:profiles(display_name)')
        .eq('task_id', id)
        .order('created_at'),
    ]);

    const issue = t.error || c.error;

    if (issue) setError(issue.message);

    const loaded = t.data as Task | null;
    const decodedDue = loaded?.due_at ? decodeWallClock(loaded.due_at) : null;
    const nextTitle = loaded?.title || '';
    const nextDescription = loaded?.description || '';
    const nextEstimated = loaded?.estimated_minutes ? String(loaded.estimated_minutes) : '';
    const nextRecurrence = parseRule(loaded?.recurrence);
    saveSeq.current += 1;
    savedDraft.current = taskDraft({
      title: nextTitle,
      description: nextDescription,
      due: decodedDue,
      estimated: nextEstimated,
      recurrence: nextRecurrence,
    });
    setTask(loaded);
    setTitle(nextTitle);
    setDescription(nextDescription);
    setDue(decodedDue);
    setEstimated(nextEstimated);
    setRecurrence(nextRecurrence);
    setComments((c.data || []) as Comment[]);
    let roster: { user_id: string; name: string }[] = [];
    if (loaded?.group_id) {
      const memberships = await supabase
        .from('group_memberships')
        .select('user_id, role, profile:profiles(display_name)')
        .eq('group_id', loaded.group_id);
      if (!memberships.error) {
        roster = (memberships.data || []).map((row) => ({
          user_id: row.user_id,
          name: personName(row.profile),
          role: typeof row.role === 'string' ? row.role : undefined,
        }));
      }
      const milestoneResult = await supabase.from('milestones').select('id,title').eq('group_id', loaded.group_id).order('sort_order').order('title');
      const fallbackMilestones = milestoneResult.error && /sort_order/.test(milestoneResult.error.message)
        ? await supabase.from('milestones').select('id,title').eq('group_id', loaded.group_id).order('title')
        : milestoneResult;
      setMilestones(fallbackMilestones.error ? [] : (fallbackMilestones.data || []) as Pick<Milestone, 'id' | 'title'>[]);
    } else {
      setMilestones([]);
    }
    setMembers(roster);
    const onlyMe = Boolean(user && loaded && (
      !loaded.group_id || (roster.length === 1 && roster[0]?.user_id === user.id)
    ));
    const alreadyMine = loaded?.assignments?.some((assignment) => assignment.user_id === user?.id);
    if (onlyMe && user && loaded && !alreadyMine) {
      const inserted = await supabase.from('task_assignments').insert({ task_id: loaded.id, user_id: user.id });
      if (!inserted.error) {
        setTask({
          ...loaded,
          assignments: [...(loaded.assignments ?? []), { user_id: user.id }],
        });
      }
    }
    setLoading(false);
  }, [id, user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);

    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!task || task.created_by !== user?.id || !savedDraft.current) return;
    const estimatedMinutes = estimated.trim() ? Number(estimated) : null;
    if (!title.trim()) {
      setError('Add a task title.');
      return;
    }
    if (estimatedMinutes != null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
      setError('Estimated minutes must be a whole number greater than 0.');
      return;
    }
    if (recurrence && !due) {
      setError('Add a due date to repeat this task.');
      return;
    }
    const savedRule = recurrence && due ? { ...recurrence, anchor: calendarStamp(due) } : null;
    const recurrenceError = savedRule ? validateRule(savedRule) : '';
    if (recurrenceError) {
      setError(recurrenceError);
      return;
    }
    const current = taskDraft({ title, description, due, estimated, recurrence: savedRule });
    if (current === savedDraft.current) return;

    const seq = ++saveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        setSaveState('saving');
        setError('');
        const values: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim(),
          due_at: due ? encodeWallClock(due) : null,
          estimated_minutes: estimatedMinutes,
        };
        const repeatingNow = Boolean(task.series_id);
        if (editScope !== 'this' || savedRule || task.recurrence) {
          values.recurrence = savedRule;
          if (savedRule && !task.series_id) values.series_id = id;
          if (!savedRule) values.series_id = null;
        }
        const result = !repeatingNow || editScope === 'this'
          ? await supabase.from('tasks').update(values).eq('id', id)
          : editScope === 'future'
            ? await supabase.from('tasks').update({ ...values, series_id: id, occurrence_index: 0 }).eq('id', id)
            : await supabase.from('tasks').update(values).eq('series_id', task.series_id).neq('status', 'completed');
        if (seq !== saveSeq.current) return;
        if (result.error) {
          setSaveState('idle');
          setError(/recurrence|series_id|schema cache|column/i.test(result.error.message)
            ? 'Run the latest SQL migration in Supabase, then try again.'
            : result.error.message);
          return;
        }
        savedDraft.current = current;
        setSaveState('saved');
        setTask((item) => item ? {
          ...item,
          title: title.trim(),
          description: description.trim(),
          due_at: due ? encodeWallClock(due) : null,
          estimated_minutes: estimatedMinutes,
          recurrence: savedRule,
          series_id: savedRule ? (item.series_id || String(id)) : null,
        } : item);
      })();
    }, 500);
    return () => clearTimeout(timer);
  }, [description, due, editScope, estimated, id, recurrence, task, title, user?.id]);

  if (loading) return <Loading />;

  if (!task) {
    return (
      <Page>
        <ErrorText>{error || 'Task not found.'}</ErrorText>
      </Page>
    );
  }

  const canEdit = task.created_by === user?.id;
  const myRole = members.find((member) => member.user_id === user?.id)?.role;
  const canDelete = task.created_by === user?.id || myRole === 'owner' || myRole === 'admin' || Boolean(task.group_id && members.some((member) => member.user_id === user?.id));
  const repeating = Boolean(task.series_id);

  const setMilestone = async (milestoneId: string | null) => {
    if (!id || busy) return;
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('tasks').update({ milestone_id: milestoneId }).eq('id', id);
    setBusy(false);
    if (issue) {
      setError(/milestone_id|schema cache|column/.test(issue.message)
        ? 'Run the latest SQL migration in Supabase, then try again.'
        : issue.message);
      return;
    }
    setTask((current) => (current ? { ...current, milestone_id: milestoneId } : current));
  };

  const toggleAssignee = async (userId: string) => {
    const assigned = task.assignments?.some((assignment) => assignment.user_id === userId);
    const result = assigned
      ? await supabase.from('task_assignments').delete().eq('task_id', id).eq('user_id', userId)
      : await supabase.from('task_assignments').insert({ task_id: id, user_id: userId });
    if (result.error) setError(result.error.message);
    else await load();
  };

  const setStatus = async (status: TaskStatus) => {
    setError('');
    try {
      await updateTaskStatus(String(id), status);
      setTask((current) => (current ? { ...current, status } : current));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the task.');
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;

    const { error: issue } = await supabase
      .from('task_comments')
      .insert({
        task_id: id,
        body: comment.trim(),
      });

    if (issue) {
      setError(issue.message);
    } else {
      setComment('');
      await load();
    }
  };

  const remove = () => {
    if (!repeating) {
      Alert.alert(
        'Delete task?',
        'This will also remove its requirements, assignments and comments.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const { data, error: issue } = await supabase.from('tasks').delete().eq('id', id).select('id');
              if (issue) setError(issue.message);
              else if (!data?.length) setError('The task was not deleted.');
              else {
                await refreshWorkspace();
                router.back();
              }
            },
          },
        ],
      );
      return;
    }
    Alert.alert(
      'Repeating task',
      'Skip this time keeps the series going. This and future stops new dates from here. The series leaves finished dates in place.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip this time',
          onPress: async () => {
            try {
              await stopRecurringTask(String(id), 'this');
              router.back();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not skip this date.');
            }
          },
        },
        {
          text: 'This and future',
          style: 'destructive',
          onPress: async () => {
            try {
              await stopRecurringTask(String(id), 'future');
              router.back();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not stop future dates.');
            }
          },
        },
      ],
    );
  };

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.group}>
              {task.group?.name || 'Personal'} · due{' '}
              {formatDate(task.due_at, { timeZone: 'UTC' })}
            </Text>
            {task.schedule_note ? <Text style={styles.group}>{task.schedule_note}</Text> : null}

            <Pill>{task.priority} priority</Pill>
            {task.series_id ? <Pill>{task.skipped ? 'Skipped' : ruleSummary(parseRule(task.recurrence))}</Pill> : null}
          </View>

        </View>

        {canEdit ? (
          <>
            <Field
              label="Task title"
              value={title}
              onChangeText={setTitle}
            />

            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              multiline
            />

            {saveState === 'saving' ? <Text style={styles.body}>Saving…</Text> : null}
            {saveState === 'saved' && !error ? <Text style={styles.body}>Saved</Text> : null}
          </>
        ) : (
          <Card>
            <Text style={styles.taskTitle}>{task.title}</Text>
            <Text style={styles.body}>
              {task.description || 'No description provided.'}
            </Text>
          </Card>
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Text style={styles.heading}>Status</Text>
        <View style={styles.finishAction}>
          <Button
            title={task.status === 'completed' ? 'Mark not finished' : 'Mark finished'}
            onPress={() => void setStatus(task.status === 'completed' ? 'todo' : 'completed')}
          />
        </View>
        <View style={styles.row}>
          {(
            [
              ['todo', 'Not started'],
              ['in_progress', 'In progress'],
              ['blocked', 'Blocked'],
              ['completed', 'Finished'],
            ] as const
          ).map(([value, name]) => (
            <Chip
              key={value}
              label={name}
              active={task.status === value}
              onPress={() => void setStatus(value)}
            />
          ))}
        </View>

        {members.some((member) => member.user_id !== user?.id) ? (
          <>
            <Text style={styles.heading}>Assigned to</Text>
            <View style={styles.row}>
              {members.map((member) => (
                <Chip
                  key={member.user_id}
                  label={member.name}
                  active={task.assignments?.some((assignment) => assignment.user_id === member.user_id)}
                  onPress={() => void toggleAssignee(member.user_id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {task.group_id ? (
          <>
            <Text style={styles.heading}>Milestone</Text>
            <Text style={styles.body}>Optional. This task stays if the milestone is removed.</Text>
            {milestones.length ? (
              <View style={styles.row}>
                <Chip label="None" active={!task.milestone_id} onPress={() => void setMilestone(null)} />
                {milestones.map((milestone) => (
                  <Chip
                    key={milestone.id}
                    label={milestone.title}
                    active={task.milestone_id === milestone.id}
                    onPress={() => void setMilestone(milestone.id)}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.body}>Add a milestone from the project timeline, then attach this task to it.</Text>
            )}
          </>
        ) : null}

        <Text style={styles.heading}>Schedule</Text>
        {repeating ? (
          <>
            <Text style={styles.body}>Apply edits to</Text>
            <View style={styles.row}>
              <Chip label="This time" active={editScope === 'this'} onPress={() => setEditScope('this')} />
              <Chip label="This and future" active={editScope === 'future'} onPress={() => setEditScope('future')} />
              <Chip label="Entire series" active={editScope === 'series'} onPress={() => setEditScope('series')} />
            </View>
          </>
        ) : null}
        <DateField label="Due" mode="datetime" value={due} onChange={setDue} />
        <RecurrenceField due={due} rule={recurrence} onChange={setRecurrence} />
        <Field label="Estimated minutes" value={estimated} onChangeText={setEstimated} keyboardType="number-pad" placeholder="Optional" />
        {canDelete ? <Button title="Delete task" danger onPress={remove} /> : null}

        {repeating && canEdit ? (
          <Button
            title="Stop the series"
            secondary
            onPress={async () => {
              try {
                await stopRecurringTask(String(id), 'series');
                router.back();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not stop the series.');
              }
            }}
          />
        ) : null}

        {task.group_id ? (
          <>
            <Text style={styles.heading}>Comments and updates</Text>

            {comments.map(item => (
              <Card key={item.id}>
                <Text style={styles.commentBy}>
                  {item.profile?.display_name || 'Teammate'} ·{' '}
                  {formatDate(item.created_at)}
                </Text>

                <Text style={styles.body}>{item.body}</Text>
              </Card>
            ))}

            <Field
              label="Write an update"
              value={comment}
              onChangeText={setComment}
              placeholder="Share progress with the project"
              multiline
            />

            <Button
              title="Post update"
              onPress={() => void addComment()}
            />
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },

  group: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 8,
  },

  delete: {
    color: colors.red,
    fontWeight: '800',
    padding: 8,
  },

  taskTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },

  body: {
    color: colors.muted,
    lineHeight: 20,
    marginTop: 7,
  },

  heading: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 9,
  },

  finishAction: {
    marginBottom: 14,
  },

  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },

  choice: {
    color: colors.muted,
    backgroundColor: 'white',
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 10,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '700',
  },

  active: {
    color: 'white',
    backgroundColor: colors.primary,
  },

  commentBy: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
} as const;
}
