import React from 'react';
import { Text, View } from 'react-native';

import { DateField } from '@/components/DateField';
import { Button, Card, Chip, ErrorText, Field, Section } from '@/components/ui';
import { useTheme } from '@/features/theme/ThemeProvider';
import {
  addMilestone,
  addPhase,
  addTask,
  movePhase,
  moveTask,
  moveTaskToPhase,
  removeMilestone,
  removePhase,
  removeTask,
  updateMilestone,
  updatePhase,
  updateTask,
  type PlanDraft,
} from '@/lib/planner/draft';
import { formatDay, parseDay } from '@/lib/planner/dates';
import type { AppColors } from '@/lib/theme';
import { type } from '@/lib/theme';
import type { PlanPriority } from '@/lib/planner/types';

const priorities: PlanPriority[] = ['low', 'medium', 'high'];

export function PlanReview({
  mode,
  projectName,
  outcome,
  draft,
  editing,
  generating,
  saving,
  draftError,
  dependencyNote,
  revision,
  includeMeetings,
  saveTitle,
  onRevision,
  onToggleEdit,
  onBack,
  onRegenerate,
  onSave,
  onManual,
  onChange,
  onDependencyNote,
  onIncludeMeetings,
  onRecalculate,
  dates,
}: {
  mode: 'new' | 'revise';
  projectName: string;
  outcome: string;
  draft: PlanDraft;
  editing: boolean;
  generating: boolean;
  saving: boolean;
  draftError: string;
  dependencyNote: string;
  revision: string;
  includeMeetings: boolean;
  saveTitle: string;
  onRevision: (value: string) => void;
  onToggleEdit: () => void;
  onBack: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onManual: (() => void) | null;
  onChange: (draft: PlanDraft) => void;
  onDependencyNote: (note: string) => void;
  onIncludeMeetings: (value: boolean) => void;
  onRecalculate: () => void;
  dates: { startDate: string; dueDate: string };
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <View>
      <Card tone="ai">
        <Text style={styles.kicker}>Draft only</Text>
        <Text style={styles.summary}>{projectName}</Text>
        <Text style={styles.note}>{outcome}</Text>
        <Text style={styles.note}>Nothing is saved until you confirm.</Text>
      </Card>

      <Section>Summary</Section>
      <Text style={styles.body}>{draft.summary}</Text>

      {draft.questions.length ? <Section>Questions</Section> : null}
      {draft.questions.slice(0, 3).map((item, index) => <Text key={`question-${index}`} style={styles.note}>{item}</Text>)}
      {draft.alternatives.length ? <Text style={styles.risk}>{draft.alternatives[0]}</Text> : null}

      <Section>Phases and tasks</Section>
      {draft.phases.map((phase, phaseIndex) => {
        const tasks = draft.tasks.filter((task) => task.phaseId === phase.id);
        return (
          <View key={phase.id}>
            <Card>
              {editing ? (
                <Field label="Phase name" value={phase.name} onChangeText={(value) => onChange(updatePhase(draft, phase.id, { name: value }))} />
              ) : (
                <Text style={styles.phase}>{phaseIndex + 1}. {phase.name}</Text>
              )}
              {phase.summary ? <Text style={styles.note}>{phase.summary}</Text> : null}
              {editing ? (
                <View style={styles.actions}>
                  <Chip label="Move up" onPress={() => onChange(movePhase(draft, phase.id, -1))} />
                  <Chip label="Move down" onPress={() => onChange(movePhase(draft, phase.id, 1))} />
                  <Chip label="Remove phase" onPress={() => {
                    const result = removePhase(draft, phase.id);
                    if (result.error) onDependencyNote(result.error);
                    else onChange(result.draft);
                  }} />
                </View>
              ) : null}
            </Card>
            {tasks.map((task) => (
              <Card key={task.id} style={styles.taskCard}>
                {editing ? (
                  <>
                    <Field label="Task title" value={task.title} onChangeText={(value) => onChange(updateTask(draft, task.id, { title: value }))} />
                    <Field label="Description" value={task.description} onChangeText={(value) => onChange(updateTask(draft, task.id, { description: value }))} multiline />
                    <View style={styles.actions}>
                      {priorities.map((priority) => (
                        <Chip key={priority} label={priority} active={task.priority === priority} onPress={() => onChange(updateTask(draft, task.id, { priority }))} />
                      ))}
                    </View>
                    <Field
                      label="Estimated minutes"
                      value={task.estimatedMinutes == null ? '' : String(task.estimatedMinutes)}
                      onChangeText={(value) => {
                        if (!value.trim()) {
                          onChange(updateTask(draft, task.id, { estimatedMinutes: null }));
                          return;
                        }
                        const minutes = Number(value);
                        if (Number.isFinite(minutes)) onChange(updateTask(draft, task.id, { estimatedMinutes: Math.round(minutes) }));
                      }}
                      keyboardType="number-pad"
                    />
                    <DateField label="Starts" value={parseDay(task.startDate)} onChange={(value) => value && onChange(updateTask(draft, task.id, { startDate: formatDay(value) }))} />
                    <DateField label="Due" value={parseDay(task.dueDate)} onChange={(value) => value && onChange(updateTask(draft, task.id, { dueDate: formatDay(value) }))} />
                    <Text style={styles.note}>Move to a phase</Text>
                    <View style={styles.actions}>
                      {draft.phases.map((item) => (
                        <Chip key={item.id} label={item.name} active={item.id === task.phaseId} onPress={() => onChange(moveTaskToPhase(draft, task.id, item.id))} />
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    {task.description ? <Text style={styles.note} numberOfLines={1}>{task.description}</Text> : null}
                    <Text style={styles.note}>
                      {task.priority}
                      {task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : ''}
                      {task.startDate && task.startDate !== task.dueDate ? ` · ${task.startDate} to ${task.dueDate}` : ` · due ${task.dueDate}`}
                      {task.assigneeName && task.assigneeName !== 'Unassigned' ? ` · ${task.assigneeName}` : ''}
                    </Text>
                  </>
                )}
                {editing ? (
                  <View style={styles.actions}>
                    <Chip label="Up" onPress={() => onChange(moveTask(draft, task.id, -1))} />
                    <Chip label="Down" onPress={() => onChange(moveTask(draft, task.id, 1))} />
                    <Chip label="Remove" onPress={() => {
                      const result = removeTask(draft, task.id);
                      onChange(result.draft);
                      onDependencyNote(result.detached.length
                        ? `Removed “${task.title}”. These tasks no longer depend on it: ${result.detached.join(', ')}.`
                        : '');
                    }} />
                  </View>
                ) : null}
              </Card>
            ))}
            {editing ? <Button title="Add task" onPress={() => onChange(addTask(draft, phase.id, dates))} secondary disabled={generating || saving} /> : null}
          </View>
        );
      })}
      {editing ? <Button title="Add phase" onPress={() => onChange(addPhase(draft))} secondary disabled={generating || saving} /> : null}

      <Section>Milestones</Section>
      {draft.milestones.length ? draft.milestones.map((milestone) => (
        <Card key={milestone.id}>
          {editing ? (
            <>
              <Field label="Milestone" value={milestone.title} onChangeText={(value) => onChange(updateMilestone(draft, milestone.id, { title: value }))} />
              <DateField label="Milestone date" value={parseDay(milestone.dueDate)} onChange={(value) => value && onChange(updateMilestone(draft, milestone.id, { dueDate: formatDay(value) }))} />
              <Chip label="Remove milestone" onPress={() => onChange(removeMilestone(draft, milestone.id))} />
            </>
          ) : (
            <>
              <Text style={styles.taskTitle}>{milestone.title}</Text>
              <Text style={styles.note}>{milestone.dueDate}</Text>
            </>
          )}
        </Card>
      )) : <Text style={styles.note}>No milestones in this draft.</Text>}
      {editing ? <Button title="Add milestone" onPress={() => onChange(addMilestone(draft, dates.dueDate))} secondary disabled={generating || saving} /> : null}

      <Section>Meetings</Section>
      <Card>
        <Text style={styles.note}>Meeting times are proposals. They stay off the calendar unless you include them.</Text>
        {draft.meetings.length ? draft.meetings.map((meeting) => (
          <Text key={meeting.title} style={styles.note}>{meeting.title}: {meeting.reason}</Text>
        )) : <Text style={styles.note}>This draft has no meeting proposals.</Text>}
        <Chip label={includeMeetings ? 'Include meetings' : 'Leave meetings off'} active={includeMeetings} onPress={() => onIncludeMeetings(!includeMeetings)} />
      </Card>

      <Section>Additional instructions</Section>
      <Field label="What should change" value={revision} onChangeText={onRevision} multiline placeholder="Optional. Used only when you regenerate." />
      {dependencyNote ? <Text style={styles.risk}>{dependencyNote}</Text> : null}
      {draftError ? <ErrorText>{draftError}</ErrorText> : null}

      <Button title="Recalculate dates" onPress={onRecalculate} secondary disabled={generating || saving} />
      <Button title="Back to details" onPress={onBack} secondary disabled={generating || saving} />
      <Button title="Regenerate plan" onPress={onRegenerate} secondary busy={generating} disabled={saving} />
      <Button title={editing ? 'Done editing' : 'Edit plan'} onPress={onToggleEdit} secondary disabled={generating || saving} />
      <Button title={saveTitle} onPress={onSave} busy={saving} disabled={generating || Boolean(draftError)} />
      {mode === 'new' && onManual ? <Button title="Create the project manually instead" onPress={onManual} secondary disabled={generating || saving} /> : null}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return {
    kicker: { color: colors.primary, fontSize: type.caption, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
    summary: { color: colors.ink, fontWeight: '700' as const, fontSize: type.body, marginTop: 6 },
    body: { color: colors.ink, fontSize: type.body, lineHeight: 22 },
    note: { color: colors.muted, fontSize: type.caption, lineHeight: 18, marginTop: 6 },
    risk: { color: colors.ink, fontSize: type.caption, lineHeight: 18, marginTop: 8 },
    phase: { color: colors.ink, fontWeight: '700' as const, fontSize: type.body },
    taskTitle: { color: colors.ink, fontWeight: '700' as const, fontSize: type.body },
    taskCard: { marginLeft: 8 },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  } as const;
}
