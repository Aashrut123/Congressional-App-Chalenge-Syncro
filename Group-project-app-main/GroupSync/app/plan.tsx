import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import { PlanReview } from '@/components/PlanReview';
import { AiBanner, Button, Card, Chip, ErrorText, Field, Page, TextButton } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { insertProject } from '@/features/plans/createProject';
import { saveReviewedPlan } from '@/features/plans/savePlan';
import { useWorkspace } from '@/hooks/useWorkspace';
import { nextPersistenceStep } from '@/lib/planner/changes';
import { draftFromPlan, planFromDraft, validateDraft, type PlanDraft } from '@/lib/planner/draft';
import { generatePlan } from '@/lib/planner/generate';
import { schedulePlan, type ScheduleOptions } from '@/lib/planner/schedule';
import { formatDay, parseDay, todayDay } from '@/lib/planner/dates';
import type { GeneratedPlan, PlannerMember } from '@/lib/planner/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import { type } from '@/lib/theme';
import type { Membership, UnavailablePeriod } from '@/types/database';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function permissionMessage(message: string) {
  if (/row-level security/i.test(message)) {
    return 'The project was not created. Sign in again and retry. Your draft is still on this screen.';
  }
  return message;
}

export default function PlanScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ groupId?: string; mode?: string; name?: string; outcome?: string; revision?: string }>();
  const requestedMode = firstParam(params.mode);
  const groupId = firstParam(params.groupId);
  const mode: 'new' | 'revise' = requestedMode === 'new' || !groupId ? 'new' : 'revise';
  const { profile, user } = useAuth();
  const { groups, tasks, refresh, loading } = useWorkspace();
  const selectedGroup = mode === 'revise' ? groups.find((group) => group.id === groupId) : undefined;
  const prefilled = useRef(false);
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const attemptedCreate = useRef(false);
  const attemptAt = useRef<string | null>(null);
  const scheduleContext = useRef<ScheduleOptions | null>(null);

  const [name, setName] = useState(firstParam(params.name));
  const [outcome, setOutcome] = useState(firstParam(params.outcome));
  const [startDate, setStartDate] = useState<Date | null>(parseDay(todayDay()));
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [requireDeadline, setRequireDeadline] = useState(false);
  const [hours, setHours] = useState('6');
  const [notes, setNotes] = useState('');
  const [milestoneText, setMilestoneText] = useState('');
  const [revision, setRevision] = useState(firstParam(params.revision));
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [includeMeetings, setIncludeMeetings] = useState(false);
  const [busy, setBusy] = useState<'build' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [dependencyNote, setDependencyNote] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [generatedFrom, setGeneratedFrom] = useState('');

  useEffect(() => {
    if (mode !== 'revise' || !selectedGroup || prefilled.current) return;
    prefilled.current = true;
    setName(selectedGroup.name);
    setOutcome(selectedGroup.outcome || selectedGroup.description || '');
    setDeadline(selectedGroup.deadline ? parseDay(selectedGroup.deadline) : null);
    setStartDate(selectedGroup.starts_on ? parseDay(selectedGroup.starts_on) : parseDay(todayDay()));
  }, [mode, selectedGroup]);

  const snapshot = () => JSON.stringify({
    name: name.trim(),
    outcome: outcome.trim(),
    start: startDate ? formatDay(startDate) : '',
    deadline: deadline ? formatDay(deadline) : '',
    requireDeadline,
    hours,
    notes: notes.trim(),
    milestones: milestoneText.trim(),
    revision: revision.trim(),
  });
  const stale = Boolean(generatedFrom && generatedFrom !== snapshot());
  const bounds = {
    startDate: startDate ? formatDay(startDate) : null,
    deadline: deadline ? formatDay(deadline) : null,
  };
  const checked = draft ? validateDraft(draft, bounds) : null;

  const build = async () => {
    if (busy || saving.current) return;
    const trimmedName = name.trim();
    const trimmedOutcome = outcome.trim();
    if (!trimmedName || trimmedName.length > 70) {
      setError('Add a project name of 70 characters or fewer.');
      return;
    }
    if (!trimmedOutcome) {
      setError('Describe what the team wants to accomplish.');
      return;
    }
    if (!startDate) {
      setError('Choose a start date.');
      return;
    }
    if (requireDeadline && !deadline) {
      setError('Add a deadline, or turn off “Deadline is required”.');
      return;
    }
    if (deadline && deadline < startDate) {
      setError('The deadline has to be on or after the start date.');
      return;
    }
    const weekly = Number(hours);
    if (!Number.isFinite(weekly) || weekly < 1 || weekly > 40) {
      setError('Weekly hours must be between 1 and 40.');
      return;
    }
    if (mode === 'revise' && !selectedGroup) {
      setError(loading ? 'The project is still loading.' : 'That project is not in your workspace.');
      return;
    }
    if (!user) {
      setError('Sign in again before creating a plan.');
      return;
    }

    setBusy('build');
    setError('');
    setDependencyNote('');
    try {
      let plannerMembers: PlannerMember[] = [];
      if (mode === 'revise') {
        const memberships = await supabase
          .from('group_memberships')
          .select('*, profile:profiles(id,display_name,skills)')
          .eq('group_id', groupId);
        if (memberships.error) throw new Error(memberships.error.message);
        const members = (memberships.data ?? []) as Membership[];
        if (!members.length) throw new Error('You are not a member of this project.');
        const ids = members.map((member) => member.user_id);
        const windowsResult = await supabase.from('availability_windows').select('*').in('user_id', ids);
        const unavailableResult = await supabase.from('unavailable_periods').select('*').in('user_id', ids);
        plannerMembers = members.map((member) => {
          const windows = ((windowsResult.error ? [] : windowsResult.data) ?? []).filter((row) => row.user_id === member.user_id);
          const weeklyFromWindows = windows.reduce(
            (sum: number, row: { start_minute: number; end_minute: number }) => sum + (row.end_minute - row.start_minute) / 60,
            0,
          );
          return {
            id: member.user_id,
            name: member.profile?.display_name || 'Teammate',
            skills: member.profile?.skills || '',
            weeklyHours: weeklyFromWindows > 0 ? Math.min(40, Math.max(1, Math.round(weeklyFromWindows))) : weekly,
            availableWeekdays: [...new Set(windows.map((row: { weekday: number }) => row.weekday))],
            unavailable: ((unavailableResult.error ? [] : unavailableResult.data ?? []) as UnavailablePeriod[])
              .filter((row) => row.user_id === member.user_id)
              .map((row) => ({ start: row.starts_on, end: row.ends_on })),
          };
        });
      } else {
        plannerMembers = [{
          id: user.id,
          name: profile?.display_name?.trim() || 'You',
          skills: profile?.skills || '',
          weeklyHours: weekly,
          availableWeekdays: [],
          unavailable: [],
        }];
      }

      const session = await supabase.auth.getSession();
      const next = await generatePlan(
        {
          title: trimmedName,
          outcome: trimmedOutcome,
          startDate: formatDay(startDate),
          deadline: deadline ? formatDay(deadline) : '',
          priority: selectedGroup?.priority || 'medium',
          weeklyHoursDefault: weekly,
          notes,
          milestones: milestoneText.split('\n').map((line) => {
            const [title, date] = line.split('|').map((part) => part.trim());
            return { title: title ?? '', date };
          }).filter((item) => item.title),
          members: plannerMembers,
          existingTasks: mode === 'revise'
            ? tasks.filter((task) => task.group_id === groupId).map((task) => ({
              title: task.title,
              status: task.status,
              assigneeId: task.assignments?.[0]?.user_id ?? null,
              estimatedMinutes: task.estimated_minutes ?? undefined,
              dueDate: task.due_at ? task.due_at.slice(0, 10) : null,
            }))
            : [],
          operation: mode,
          groupId: mode === 'revise' ? groupId : null,
          revision,
          focus: profile?.goals?.[0],
          pace: profile?.planning_style,
        },
        {
          useAi: Boolean(session.data.session?.access_token),
          supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
          accessToken: session.data.session?.access_token,
          apiKey: isSupabaseConfigured ? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY : undefined,
        },
      );
      scheduleContext.current = {
        startDate: formatDay(startDate),
        deadline: deadline ? formatDay(deadline) : null,
        weeklyHours: weekly,
        notes: [trimmedOutcome, notes, revision].filter(Boolean).join('\n'),
        members: plannerMembers.map((member) => ({
          id: member.id,
          name: member.name,
          weeklyHours: member.weeklyHours,
          availableWeekdays: member.availableWeekdays,
          unavailable: member.unavailable,
          skills: member.skills,
        })),
        existingTasks: mode === 'revise'
          ? tasks.filter((task) => task.group_id === groupId).map((task) => ({
            title: task.title,
            status: task.status,
            assigneeId: task.assignments?.[0]?.user_id ?? null,
            estimatedMinutes: task.estimated_minutes ?? null,
            dueDate: task.due_at ? task.due_at.slice(0, 10) : null,
          }))
          : [],
      };
      setPlan(next);
      setDraft(draftFromPlan(next));
      setIncludeMeetings(false);
      setEditing(false);
      setGeneratedFrom(snapshot());
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build a plan.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (busy || saving.current || !plan || !draft || !checked?.ok) return;
    const projectForStep = createdId || (mode === 'revise' ? groupId : null);
    const persistence = nextPersistenceStep(mode, projectForStep);
    if (persistence === 'blocked') {
      setError('Choose a project before saving a revision.');
      return;
    }
    if (!user) {
      setError('Sign in again before saving.');
      return;
    }
    saving.current = true;
    setBusy('save');
    setError('');
    let projectId = projectForStep;
    if (persistence === 'create') {
      if (!attemptAt.current) attemptAt.current = new Date(Date.now() - 2 * 60_000).toISOString();
      if (attemptedCreate.current || createUncertain) {
        const found = await supabase
          .from('groups')
          .select('id')
          .eq('created_by', user.id)
          .eq('name', name.trim())
          .gte('created_at', attemptAt.current)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (found.data?.id) {
          projectId = found.data.id as string;
          setCreatedId(projectId);
          setCreateUncertain(false);
        }
      }
      if (!projectId) {
        attemptedCreate.current = true;
        const payload = {
          name: name.trim(),
          description: '',
          color: '#2B7168',
          created_by: user.id,
          outcome: outcome.trim(),
          deadline: deadline ? formatDay(deadline) : null,
          starts_on: startDate ? formatDay(startDate) : formatDay(new Date()),
          priority: 'medium' as const,
          status: 'active',
        };
        let created = await insertProject(payload);
        if (created.error && /outcome|deadline|starts_on|priority|status/.test(created.error.message)) {
          created = await insertProject({
            name: payload.name,
            description: '',
            color: payload.color,
            created_by: user.id,
          });
        }
        if (created.error || !created.id) {
          if (!created.id) setCreateUncertain(true);
          saving.current = false;
          setBusy(null);
          setError(created.error ? permissionMessage(created.error.message) : 'The project may have been created, but it could not be opened. Check Projects before trying again.');
          return;
        }
        projectId = created.id;
        setCreatedId(created.id);
        setCreateUncertain(false);
      }
    }
    if (!projectId) {
      saving.current = false;
      setBusy(null);
      setError('The project could not be saved.');
      return;
    }
    if (!requestId.current) {
      requestId.current = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const result = await saveReviewedPlan({
      groupId: projectId,
      plan,
      tasks: checked.value.tasks,
      milestones: checked.value.milestones,
      meetings: includeMeetings ? plan.meetings : [],
      clientRequestId: requestId.current,
      bounds,
      input: {
        operation: mode,
        name: name.trim(),
        outcome: outcome.trim(),
        startDate: bounds.startDate,
        deadline: bounds.deadline,
        hours,
        notes,
        milestones: milestoneText,
        revision,
        clientRequestId: requestId.current,
      },
    });
    saving.current = false;
    setBusy(null);
    if (result.error) {
      const kept = mode === 'new' ? ' The project was kept. Retrying will not create a second copy.' : ' Nothing already saved was removed.';
      setError(`${result.error}${result.savedTasks ? ` ${result.savedTasks} task${result.savedTasks === 1 ? '' : 's'} were saved before the error.` : ''}${kept}`);
      return;
    }
    await refresh();
    router.replace(`/group/${projectId}`);
  };

  const recalculate = () => {
    if (!draft || !plan || !scheduleContext.current || busy) return;
    try {
      const next = schedulePlan(planFromDraft(draft, plan), scheduleContext.current);
      setPlan(next);
      setDraft(draftFromPlan(next));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not recalculate the dates.');
    }
  };

  const openManual = () => {
    router.push({ pathname: '/create-group', params: { name: name.trim(), outcome: outcome.trim() } });
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <AiBanner
          title={mode === 'new' ? 'Create a project with AI' : 'Revise this project'}
          body={mode === 'new'
            ? 'Describe the outcome. You will review the draft before a project is created.'
            : 'This uses the current project, its tasks, and its members. Completed work stays, and nothing is deleted.'}
        />
        {step === 'details' ? (
          <View>
            {mode === 'revise' ? (
              <Card>
                <Text style={styles.projectName}>{selectedGroup?.name || name || 'Project'}</Text>
                <Text style={styles.note}>The project name and deadline already stored on the project are not changed here.</Text>
              </Card>
            ) : (
              <Field label="Project name" value={name} onChangeText={setName} placeholder="Congressional app" maxLength={70} />
            )}
            <Field label="Desired outcome" value={outcome} onChangeText={setOutcome} multiline placeholder="What should be true when this work is done?" maxLength={2000} />
            <DateField label="Start date" value={startDate} onChange={setStartDate} />
            <DateField label="Deadline" value={deadline} onChange={setDeadline} />
            <Chip label={requireDeadline ? 'Deadline is required' : 'Deadline is optional'} active={requireDeadline} onPress={() => setRequireDeadline((value) => !value)} />
            <Field label="Hours each person can give per week" value={hours} onChangeText={setHours} keyboardType="number-pad" />
            <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything else the planner should know" maxLength={2000} />
            <Text style={styles.note}>Optional. The planner reads this when it builds the draft.</Text>
            <Text style={styles.note}>
              {mode === 'new'
                ? 'You are the only member until people join with an invitation. This planner does not invite anyone.'
                : 'People already on the project are used as context. Tasks are not assigned from this screen.'}
            </Text>
            <Field label="Milestones, one per line" value={milestoneText} onChangeText={setMilestoneText} multiline placeholder={'Working prototype | 2026-11-10\nDemo video'} />
            <Text style={styles.note}>Leave milestones blank and the planner can suggest them. Estimated durations and dates are proposals, not guarantees.</Text>
            {stale ? <Text style={styles.note}>These details differ from the current draft.</Text> : null}
            {busy === 'build' ? <Text style={styles.note}>Generating a plan. This can take up to a minute. Nothing is saved yet.</Text> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button title={draft ? 'Regenerate plan' : 'Generate plan'} onPress={() => void build()} busy={busy === 'build'} disabled={busy === 'save'} />
            {draft ? <Button title="Return to draft" onPress={() => { setError(''); setStep('review'); }} secondary disabled={Boolean(busy)} /> : null}
            {mode === 'new' ? <TextButton title="Create the project manually instead" onPress={openManual} /> : null}
          </View>
        ) : null}

        {step === 'review' && draft ? (
          <View>
            {busy === 'build' ? <Text style={styles.note}>Generating a new plan. The current draft stays until a real plan comes back.</Text> : null}
            {stale ? <Text style={styles.note}>Details changed after this draft. Regenerate to use them. Local edits below do not call the planner.</Text> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <PlanReview
              mode={mode}
              projectName={name.trim() || selectedGroup?.name || 'Project'}
              outcome={outcome.trim()}
              draft={draft}
              editing={editing}
              generating={busy === 'build'}
              saving={busy === 'save'}
              draftError={checked && !checked.ok ? checked.error : ''}
              dependencyNote={dependencyNote}
              revision={revision}
              includeMeetings={includeMeetings}
              saveTitle={mode === 'new' && !createdId ? 'Create project and save plan' : mode === 'new' ? 'Save plan to the new project' : 'Save additions'}
              onRevision={setRevision}
              onToggleEdit={() => setEditing((value) => !value)}
              onBack={() => { setError(''); setStep('details'); }}
              onRegenerate={() => void build()}
              onSave={() => void save()}
              onManual={createdId ? null : openManual}
              onChange={setDraft}
              onDependencyNote={setDependencyNote}
              onIncludeMeetings={setIncludeMeetings}
              onRecalculate={recalculate}
              dates={{ startDate: bounds.startDate || '2026-01-01', dueDate: bounds.deadline || bounds.startDate || '2026-01-01' }}
            />
          </View>
        ) : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
    projectName: { color: colors.ink, fontWeight: '700' as const, fontSize: type.body },
    note: { color: colors.muted, fontSize: type.caption, lineHeight: 18, marginTop: 6, marginBottom: 8 },
  } as const;
}
