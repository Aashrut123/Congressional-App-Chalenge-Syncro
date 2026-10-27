import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import { Button, Chip, EmptyState, ErrorText, Field, Page, SelectCard, TextButton } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { insertProject } from '@/features/plans/createProject';
import { useTheme } from '@/features/theme/ThemeProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { encodeWallClock } from '@/lib/format';
import { saveInviteCode } from '@/lib/inviteCodes';
import { formatDay } from '@/lib/planner/dates';
import { easeLayout, usePrefersReducedMotion } from '@/lib/motion';
import type { AppColors } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import type { TaskPriority } from '@/types/database';

const STEPS = ['Basics', 'Team', 'Plan', 'Review'] as const;
const SWATCHES = ['#2B7168', '#5578B8', '#C66A54', '#8A68A8', '#C59130'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high'];

type StartMethod = 'blank' | 'manual';

type DraftTask = {
  key: string;
  title: string;
  priority: TaskPriority;
  due: Date | null;
};

type PendingInvite = { key: string };

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function createLabel(method: StartMethod, taskCount: number, busy: boolean) {
  if (busy) return 'Creating…';
  if (method === 'manual' && taskCount > 0) {
    return taskCount === 1 ? 'Create with 1 task' : `Create with ${taskCount} tasks`;
  }
  return 'Create blank project';
}

function permissionMessage(message: string) {
  if (/row-level security/i.test(message)) {
    return 'The project was not created. Sign out, sign in again, and try once more. Your name, deadline, and tasks are still on this screen.';
  }
  return message;
}

export default function CreateGroupScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ fresh?: string; name?: string; outcome?: string }>();
  const { profile, user } = useAuth();
  const { refresh } = useWorkspace();
  const reduceMotion = usePrefersReducedMotion();
  const saving = useRef(false);

  const [step, setStep] = useState(0);
  const [name, setName] = useState(firstParam(params.name));
  const [description, setDescription] = useState('');
  const [outcome] = useState(firstParam(params.outcome));
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [color, setColor] = useState(SWATCHES[0]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [method, setMethod] = useState<StartMethod>('blank');
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPriority, setDraftPriority] = useState<TaskPriority>('medium');
  const [draftDue, setDraftDue] = useState<Date | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const creatorName = profile?.display_name?.trim() || 'You';
  const plannedTasks = method === 'manual' ? tasks : [];

  const go = (next: number) => {
    easeLayout(reduceMotion);
    setError('');
    setStep(next);
  };

  const continueBasics = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Add a project name to continue.');
      return;
    }
    if (trimmed.length > 70) {
      setError('Project names can be at most 70 characters.');
      return;
    }
    go(1);
  };

  const addInvite = () => {
    if (invites.length >= 5) {
      setError('You can prepare up to 5 invitation codes here. More can be created from the project.');
      return;
    }
    setError('');
    setInvites((current) => [...current, { key: `invite-${current.length}-${Date.now()}` }]);
  };

  const saveDraft = () => {
    const title = draftTitle.trim();
    if (!title) {
      setError('Add a task title, or leave the plan empty.');
      return;
    }
    if (title.length > 160) {
      setError('Task titles can be at most 160 characters.');
      return;
    }
    setError('');
    const next: DraftTask = {
      key: editingKey || `task-${tasks.length}-${Date.now()}`,
      title,
      priority: draftPriority,
      due: draftDue,
    };
    setTasks((current) => {
      if (!editingKey) return [...current, next];
      return current.map((task) => (task.key === editingKey ? next : task));
    });
    setDraftTitle('');
    setDraftPriority('medium');
    setDraftDue(null);
    setEditingKey(null);
  };

  const editTask = (task: DraftTask) => {
    setEditingKey(task.key);
    setDraftTitle(task.title);
    setDraftPriority(task.priority);
    setDraftDue(task.due);
    setError('');
  };

  const create = async () => {
    if (saving.current) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 70) {
      setError('Add a project name of 70 characters or fewer.');
      go(0);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');

    if (!user) {
      saving.current = false;
      setBusy(false);
      setError('Sign in again before creating a project.');
      return;
    }
    const payload = {
      name: trimmed,
      description: description.trim(),
      color,
      created_by: user.id,
      outcome: outcome.trim(),
      deadline: deadline ? formatDay(deadline) : null,
      starts_on: formatDay(new Date()),
      priority: 'medium',
      status: 'active',
    };
    let created = await insertProject(payload);
    if (created.error && /outcome|deadline|starts_on|priority|status/.test(created.error.message)) {
      created = await insertProject({
        name: payload.name,
        description: payload.description,
        color,
        created_by: user.id,
      });
    }

    if (created.error || !created.id) {
      saving.current = false;
      setBusy(false);
      setError(created.error ? permissionMessage(created.error.message) : 'The project was saved, but it could not be opened. Pull to refresh on Projects.');
      return;
    }
    const projectId = created.id;

    const codes: string[] = [];
    for (let index = 0; index < invites.length; index += 1) {
      const invite = await supabase.rpc('create_group_invitation', { target_group_id: projectId, valid_days: 14 });
      if (typeof invite.data === 'string' && invite.data) codes.push(invite.data);
    }
    if (codes.length) await saveInviteCode(projectId, codes.join('\n'), 1);

    for (const task of plannedTasks) {
      await supabase.from('tasks').insert({
        group_id: projectId,
        title: task.title,
        description: '',
        due_at: task.due ? encodeWallClock(task.due) : null,
        priority: task.priority,
      });
    }

    void refresh();
    saving.current = false;
    setBusy(false);
    router.replace(`/group/${projectId}`);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Page>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <View style={styles.steps} accessibilityRole="tablist">
            {STEPS.map((label, index) => {
              const active = index === step;
              const done = index < step;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label}, step ${index + 1} of ${STEPS.length}`}
                  onPress={() => {
                    if (index > 0 && !name.trim()) {
                      setError('Add a project name before leaving Basics.');
                      return;
                    }
                    go(index);
                  }}
                  style={styles.stepHit}
                >
                  <Text style={[styles.stepLabel, active && styles.stepLabelOn, done && styles.stepLabelDone]}>{label}</Text>
                  <View style={[styles.stepBar, (active || done) && styles.stepBarOn]} />
                </Pressable>
              );
            })}
          </View>

          {step === 0 ? (
            <>
              <Text style={styles.lead}>Name the project. A description, color, and deadline can wait.</Text>
              <Field label="Project name" placeholder="e.g. Robotics notebook" value={name} onChangeText={setName} maxLength={70} />
              <Field label="Short description" placeholder="Optional. What is this project for?" value={description} onChangeText={setDescription} multiline maxLength={400} />
              <Text style={styles.label}>Color</Text>
              <View style={styles.swatches}>
                {SWATCHES.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`Project color ${value}`}
                    accessibilityState={{ selected: color === value }}
                    onPress={() => setColor(value)}
                    style={[styles.swatch, { backgroundColor: value }, color === value && styles.swatchOn]}
                  />
                ))}
              </View>
              <DateField label="Target deadline" value={deadline} onChange={setDeadline} />
              {deadline ? <TextButton title="Clear deadline" onPress={() => setDeadline(null)} /> : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={styles.lead}>You are the owner. Teammates join with a single-use code. Nothing is emailed, and no code is created until you finish.</Text>
              <View style={styles.person}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{creatorName[0]?.toUpperCase() || 'Y'}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.personName}>{creatorName}</Text>
                  <Text style={styles.meta}>Project creator · Owner</Text>
                </View>
              </View>
              {invites.length ? invites.map((invite, index) => (
                <View key={invite.key} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>Invitation code {index + 1}</Text>
                    <Text style={styles.meta}>Created when you finish · one use · 14 days</Text>
                  </View>
                  <TextButton title="Remove" onPress={() => setInvites((current) => current.filter((item) => item.key !== invite.key))} />
                </View>
              )) : (
                <EmptyState compact title="No invitations yet" body="Skip this step and add teammates from the project later." />
              )}
              <Button title="Add invitation code" onPress={addInvite} secondary disabled={busy} />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={styles.lead}>Choose how the workspace starts. You can add more tasks after the project exists.</Text>
              <SelectCard
                title="Start with a blank project"
                detail="Create the workspace only. Organize the work yourself afterward."
                selected={method === 'blank'}
                onPress={() => setMethod('blank')}
              />
              <SelectCard
                title="Build the plan manually"
                detail="Add the first tasks now. You can edit or remove them before saving."
                selected={method === 'manual'}
                onPress={() => setMethod('manual')}
              />
              <SelectCard
                title="Create a project with AI"
                detail="Describe the goal, review the draft, and save the project only after you approve it."
                selected={false}
                onPress={() => router.push({ pathname: '/plan', params: { mode: 'new', name: name.trim(), outcome } })}
              />
              {method === 'manual' ? (
                <>
                  <Text style={styles.label}>{editingKey ? 'Edit task' : 'Initial tasks'}</Text>
                  <Field label="Task title" placeholder="e.g. Compare the core flow" value={draftTitle} onChangeText={setDraftTitle} maxLength={160} />
                  <View style={styles.choices}>
                    {PRIORITIES.map((priority) => (
                      <Chip key={priority} label={priority} active={draftPriority === priority} onPress={() => setDraftPriority(priority)} />
                    ))}
                  </View>
                  <DateField label="Due date" value={draftDue} onChange={setDraftDue} />
                  <Button title={editingKey ? 'Save task' : 'Add task'} onPress={saveDraft} secondary />
                  {editingKey ? <TextButton title="Cancel edit" onPress={() => { setEditingKey(null); setDraftTitle(''); setDraftDue(null); }} /> : null}
                  {tasks.length ? tasks.map((task) => (
                    <View key={task.key} style={styles.taskRow}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`} onPress={() => editTask(task)} style={{ flex: 1 }}>
                        <Text style={styles.personName}>{task.title}</Text>
                        <Text style={styles.meta}>
                          {task.priority}
                          {task.due ? ` · due ${task.due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                        </Text>
                      </Pressable>
                      <TextButton title="Remove" onPress={() => setTasks((current) => current.filter((item) => item.key !== task.key))} />
                    </View>
                  )) : (
                    <EmptyState compact title="No tasks yet" body="Add a title above, or continue and start from an empty project." />
                  )}
                </>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.lead}>This is what will be saved. Go back to any step to change it.</Text>
              <View style={styles.summary}>
                <View style={styles.summaryTitle}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.personName}>{name.trim() || 'Untitled project'}</Text>
                </View>
                <Text style={styles.meta}>{description.trim() || 'No description'}</Text>
                <Text style={styles.meta}>{deadline ? `Deadline ${deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No deadline'}</Text>
                {outcome.trim() ? <Text style={styles.meta}>Outcome: {outcome.trim()}</Text> : null}
              </View>
              <Text style={styles.label}>People</Text>
              <Text style={styles.meta}>{creatorName} · owner</Text>
              <Text style={styles.meta}>
                {invites.length
                  ? `${invites.length} invitation ${invites.length === 1 ? 'code' : 'codes'} will be created. They are not emailed.`
                  : 'No invitations. You can create a code from the project later.'}
              </Text>
              <Text style={styles.label}>Starting method</Text>
              <Text style={styles.meta}>{method === 'manual' ? 'Build the plan manually' : 'Blank project'}</Text>
              <Text style={styles.label}>Tasks that will be created</Text>
              {plannedTasks.length ? plannedTasks.map((task) => (
                <Text key={task.key} style={styles.meta}>
                  {task.title} · {task.priority}
                </Text>
              )) : (
                <Text style={styles.meta}>None. The project will not include starter tasks.</Text>
              )}
              <View style={styles.editRow}>
                <TextButton title="Edit basics" onPress={() => go(0)} />
                <TextButton title="Edit team" onPress={() => go(1)} />
                <TextButton title="Edit plan" onPress={() => go(2)} />
              </View>
            </>
          ) : null}

          {error ? <ErrorText>{error}</ErrorText> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 ? <Button title="Back" onPress={() => go(step - 1)} secondary disabled={busy} style={styles.footerButton} /> : null}
          {step === 0 ? <Button title="Continue" onPress={continueBasics} disabled={busy} style={styles.footerButton} /> : null}
          {step === 1 ? (
            <>
              <Button title="Skip" onPress={() => { setInvites([]); go(2); }} secondary disabled={busy} style={styles.footerButton} />
              <Button title="Continue" onPress={() => go(2)} disabled={busy} style={styles.footerButton} />
            </>
          ) : null}
          {step === 2 ? <Button title="Review" onPress={() => go(3)} disabled={busy} style={styles.footerButton} /> : null}
          {step === 3 ? (
            <Button title={createLabel(method, plannedTasks.length, busy)} onPress={() => void create()} busy={busy} disabled={busy} style={styles.footerButton} />
          ) : null}
        </View>
      </Page>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors) {
  return {
    scroll: { paddingBottom: 12 },
    steps: { flexDirection: 'row' as const, gap: 8, marginBottom: 16 },
    stepHit: { flex: 1, minHeight: 44, justifyContent: 'flex-end' as const },
    stepLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' as const, marginBottom: 6 },
    stepLabelOn: { color: colors.text },
    stepLabelDone: { color: colors.primary },
    stepBar: { height: 3, borderRadius: 3, backgroundColor: colors.border },
    stepBarOn: { backgroundColor: colors.primary },
    lead: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginBottom: 14 },
    label: { color: colors.text, fontSize: 13, fontWeight: '700' as const, marginTop: 8, marginBottom: 8 },
    note: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12 },
    swatches: { flexDirection: 'row' as const, gap: 10, marginBottom: 16 },
    swatch: { width: 36, height: 36, borderRadius: 18 },
    swatchOn: { borderWidth: 3, borderColor: colors.text },
    person: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginBottom: 14 },
    avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarText: { color: colors.onMint, fontWeight: '700' as const, fontSize: 16 },
    personName: { color: colors.text, fontSize: 16, fontWeight: '700' as const },
    meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
    inviteRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 8 },
    taskRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    summary: { marginBottom: 8 },
    summaryTitle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    editRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 16, marginTop: 8 },
    footer: { flexDirection: 'row' as const, gap: 8, paddingTop: 8, paddingBottom: 8 },
    footerButton: { flex: 1, marginTop: 0 },
  } as const;
}
