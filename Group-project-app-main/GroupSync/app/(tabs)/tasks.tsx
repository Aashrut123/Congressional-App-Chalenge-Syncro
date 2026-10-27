import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Page,
  Pill,
  Segmented,
  priorityTone,
  statusTone,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { updateTaskStatus, useWorkspace } from '@/hooks/useWorkspace';
import { assigneeLabel, decodeWallClock, formatDate } from '@/lib/format';
import { calendarStamp, isVisibleOccurrence, ruleSummary, parseRule } from '@/lib/recurrence';
import { taskStatusLabel } from '@/lib/planner/status';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import { type } from '@/lib/theme';
import { preferredTimeZone } from '@/lib/timezone';
import type { Task, TaskStatus } from '@/types/database';
import { SafeAreaView } from 'react-native-safe-area-context';

type TaskView = 'today' | 'upcoming' | 'all';

const views: { id: TaskView; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All tasks' },
];

function inView(task: Task, view: TaskView, today: string): boolean {
  if (!isVisibleOccurrence(task)) return false;
  if (view === 'all') return true;
  const due = task.due_at ? calendarStamp(decodeWallClock(task.due_at)) : null;
  if (!due) return false;
  if (view === 'today') return due <= today;
  return due > today;
}

const label: Record<TaskStatus, string> = {
  todo: taskStatusLabel('todo'),
  in_progress: taskStatusLabel('in_progress'),
  blocked: taskStatusLabel('blocked'),
  completed: taskStatusLabel('completed'),
};

export default function TasksScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { profile } = useAuth();
  const { tasks, loading, error, refresh } = useWorkspace();
  const { refreshControl } = usePullRefresh(refresh);
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<TaskView>('today');
  const [searchOpen, setSearchOpen] = useState(false);
  const timeZone = preferredTimeZone(profile?.timezone);
  const today = calendarStamp(new Date());

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const scoped = tasks.filter((task) => inView(task, view, today));
  const visible = scoped
    .filter((task) => {
      const haystack = `${task.title} ${task.description}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    })
    .sort((a, b) =>
      (a.due_at || '9999').localeCompare(b.due_at || '9999')
    );
  const scopeLabel = view === 'today' ? 'Today' : view === 'upcoming' ? 'Upcoming' : 'All tasks';

  if (loading) {
    return <Loading />;
  }

  const toggleFinished = async (taskId: string, current: TaskStatus) => {
    if (pendingId) return;
    const next = current === 'completed' ? 'todo' : 'completed';
    setPendingId(taskId);
    try {
      await updateTaskStatus(taskId, next);
    } catch {
      await refresh();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={refreshControl}
        >
          <View style={styles.head}>
            <Text style={styles.screenTitle}>My Tasks</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? 'Close search' : 'Search tasks'}
              accessibilityState={{ expanded: searchOpen }}
              onPress={() => {
                setSearchOpen((open) => !open);
                if (searchOpen) setQuery('');
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
            >
              <Ionicons name={searchOpen ? 'close' : 'search'} size={22} color={colors.text} />
            </Pressable>
          </View>

          <Segmented options={views} value={view} onChange={(id) => setView(id as TaskView)} />

          <Text style={styles.summaryCount}>
            {visible.length} {visible.length === 1 ? 'task' : 'tasks'} · {scopeLabel}
          </Text>

          {searchOpen ? (
            <Field label="Search" value={query} onChangeText={setQuery} placeholder="Search titles and descriptions" autoCapitalize="none" />
          ) : null}

          {error ? <ErrorText>{error}</ErrorText> : null}

          {visible.length ? (
            visible.map(task => (
              <Card key={task.id} style={styles.task}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: pendingId === task.id, checked: task.status === 'completed' }}
                  accessibilityLabel={task.status === 'completed' ? 'Mark not finished' : 'Mark finished'}
                  disabled={pendingId === task.id}
                  onPress={() => void toggleFinished(task.id, task.status)}
                  hitSlop={6}
                  style={({ pressed }) => [styles.check, pressed && styles.checkPressed]}
                >
                  <View style={[styles.mark, task.status === 'completed' && styles.markOn, pendingId === task.id && styles.markBusy]}>
                    {task.status === 'completed' ? <Ionicons name="checkmark" size={15} color={colors.primaryForeground} /> : null}
                  </View>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={task.title} onPress={() => router.push(`/task/${task.id}`)} style={styles.taskBody}>
                  <Text style={[styles.taskTitle, task.status === 'completed' && styles.taskDone]} numberOfLines={2}>{task.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[task.group?.name || 'Personal', task.assignments?.length ? assigneeLabel(task.assignments) : '', task.due_at ? formatDate(task.due_at, { timeZone }) : 'No due date', task.schedule_note || '', task.series_id ? ruleSummary(parseRule(task.recurrence)) : ''].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.pills}>
                    <Pill tone={priorityTone(task.priority)}>{task.priority}</Pill>
                    <Pill tone={statusTone(task.status)}>{label[task.status]}</Pill>
                  </View>
                </Pressable>
              </Card>
            ))
          ) : (
            <EmptyState
              compact
              title={query.trim() ? 'No tasks match this search' : view === 'today' ? 'Nothing due today' : view === 'upcoming' ? 'Nothing coming up' : 'No tasks yet'}
              body={
                query.trim()
                  ? 'Try a different word from a title or description.'
                  : view === 'all'
                    ? 'Add work to a project and it will show up here.'
                    : 'Tasks with a due date in this range show up here. All tasks still lists everything.'
              }
            />
          )}

          <Button
            title="Create a task"
            onPress={() => router.push('/create-task')}
          />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return {
    head: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 14, marginTop: 4 },
    screenTitle: { color: colors.text, fontSize: type.title, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.6 },
    iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    iconPressed: { opacity: 0.6 },
    summaryCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' as const, marginTop: -6, marginBottom: 10 },
    task: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 4, paddingVertical: 12, paddingLeft: 4, paddingRight: 14, marginBottom: 8 },
    taskBody: { flex: 1, paddingTop: 8 },
    taskTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '700' as const },
    taskDone: { color: colors.textSecondary },
    meta: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 4 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
    check: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
    checkPressed: { opacity: 0.7 },
    mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface },
    markOn: { backgroundColor: colors.primary },
    markBusy: { opacity: 0.45 },
  } as const;
}

