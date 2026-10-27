import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorText, Loading, Page, Pill, Segmented } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/features/theme/ThemeProvider';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { updateTaskStatus, useWorkspace } from '@/hooks/useWorkspace';
import { findConflicts } from '@/lib/planner/conflicts';
import { stampInRange } from '@/lib/planner/dates';
import { decodeWallClock, encodeWallClock, formatClockFace, pickedInstant } from '@/lib/format';
import { parseRule, repeatDates } from '@/lib/recurrence';
import { DEFAULT_TIME_ZONE, overlapsZonedDay, preferredTimeZone, weekdayIndex, zonedDayStamp } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { AppColors } from '@/lib/theme';
import type { CalendarEvent, Task, UnavailablePeriod } from '@/types/database';

type ViewName = 'agenda' | 'week' | 'month';
type ItemKind = 'meeting' | 'event' | 'deadline' | 'task' | 'milestone' | 'unavailable';

type CalendarItem = {
  key: string;
  title: string;
  kind: ItemKind;
  start: string;
  end: string;
  project: string;
  location: string;
  who: string;
  href: string;
  taskId: string | null;
  taskStatus: Task['status'] | null;
  allDay: boolean;
};

type MilestoneRow = {
  id: string;
  title: string;
  due_on: string | null;
  completed_at: string | null;
  group_id: string;
};

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function dayStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(date: Date, count: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + count);
  return next;
}

function parseStamp(stamp: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function zonedToday(timeZone: string, now = new Date()): Date {
  return parseStamp(zoneDay(now, timeZone));
}

function zoneDay(date: Date, timeZone: string): string {
  return zonedDayStamp(date, timeZone);
}

function weekStart(day: Date): Date {
  return addDays(day, -weekdayIndex(dayStamp(day)));
}

function itemStamp(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = pickedInstant(value, timeZone);
  if (Number.isNaN(instant.getTime())) return '';
  return zoneDay(instant, timeZone);
}

function dueHasPassed(item: CalendarItem, timeZone: string, now: Date): boolean {
  if (item.kind !== 'task' && item.kind !== 'milestone' && item.kind !== 'deadline') return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(item.start)) return item.start < zoneDay(now, timeZone);
  const instant = pickedInstant(item.start, timeZone);
  return !Number.isNaN(instant.getTime()) && instant.getTime() < now.getTime();
}

function onDay(item: CalendarItem, day: Date, timeZone: string) {
  const stamp = dayStamp(day);
  if (/^\d{4}-\d{2}-\d{2}$/.test(item.start)) return stampInRange(item.start, item.end, stamp);
  const start = itemStamp(item.start, timeZone);
  const end = itemStamp(item.end, timeZone) || start;
  if (start) return start <= stamp && stamp <= end;
  return overlapsZonedDay(item.start, item.end, day, timeZone);
}

function kindLabel(kind: ItemKind) {
  if (kind === 'meeting') return 'Meeting';
  if (kind === 'task') return 'Task';
  if (kind === 'deadline') return 'Deadline';
  if (kind === 'milestone') return 'Milestone';
  if (kind === 'unavailable') return 'Away';
  return 'Event';
}

function kindIcon(kind: ItemKind): keyof typeof Ionicons.glyphMap {
  if (kind === 'meeting') return 'people-outline';
  if (kind === 'task') return 'checkmark-circle-outline';
  if (kind === 'deadline' || kind === 'milestone') return 'flag-outline';
  if (kind === 'unavailable') return 'remove-circle-outline';
  return 'calendar-outline';
}

function headingFor(stamp: string, today: string) {
  if (stamp === 'overdue') return 'Overdue';
  if (stamp === today) return 'Today';
  const tomorrow = dayStamp(addDays(parseStamp(today), 1));
  if (stamp === tomorrow) return 'Tomorrow';
  return parseStamp(stamp).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, profile } = useAuth();
  const timeZone = preferredTimeZone(profile?.timezone);
  const { groups, events, tasks, unavailable, loading, error, refresh } = useWorkspace();
  const { refreshControl } = usePullRefresh(refresh);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [view, setView] = useState<ViewName>('agenda');
  const [selectedDay, setSelectedDay] = useState(() => zonedToday(DEFAULT_TIME_ZONE));
  const appliedZone = useRef(DEFAULT_TIME_ZONE);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const groupKey = groups.map((group) => group.id).join(',');

  useEffect(() => {
    if (appliedZone.current === timeZone) return;
    appliedZone.current = timeZone;
    setSelectedDay(zonedToday(timeZone));
  }, [timeZone]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  useEffect(() => {
    let active = true;
    const ids = groups.map((group) => group.id);
    if (ids.length) {
      void supabase.from('milestones').select('id, title, due_on, completed_at, group_id').in('group_id', ids).then((result) => {
        if (!active) return;
        setMilestones(result.error ? [] : (result.data || []) as MilestoneRow[]);
      });
    }
    return () => {
      active = false;
    };
  }, [groupKey, groups]);

  const items = useMemo(() => {
    const ids = new Set(groups.map((group) => group.id));
    const current = milestones.filter((milestone) => ids.has(milestone.group_id));
    return buildItems(events, tasks, groups.length ? current : [], unavailable, user?.id, groups, timeZone);
  }, [events, tasks, milestones, unavailable, user?.id, groups, timeZone]);

  const today = zonedToday(timeZone);
  const todayStamp = dayStamp(today);
  const conflicts = findConflicts(events.filter((event) => pickedInstant(event.ends_at, timeZone).getTime() > today.getTime()).map((event) => ({
    id: event.id,
    title: event.title,
    start: event.starts_at,
    end: event.ends_at,
    kind: event.kind === 'deadline' ? 'deadline' as const : event.kind === 'meeting' ? 'meeting' as const : 'event' as const,
  })));

  const hasOn = useCallback((day: Date) => items.some((item) => onDay(item, day, timeZone)), [items, timeZone]);

  const shift = (direction: number) => {
    const next = new Date(selectedDay);
    if (view === 'month') next.setMonth(next.getMonth() + direction);
    else if (view === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    setSelectedDay(next);
  };

  const rangeLabel = view === 'month'
    ? selectedDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${weekStart(selectedDay).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart(selectedDay), 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : sameDay(selectedDay, today) ? 'Today' : selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const dayParam = dayStamp(selectedDay);

  if (loading && !events.length && !tasks.length) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }} refreshControl={refreshControl}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Calendar</Text>
              <Text style={styles.range}>{rangeLabel}</Text>
            </View>
            <Button title="Add" onPress={() => router.push({ pathname: '/create-event', params: { day: dayParam } })} style={styles.add} />
          </View>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {conflicts.length ? <Text style={styles.conflict}>{conflicts[0]?.a} overlaps {conflicts[0]?.b}.</Text> : null}

          <Segmented options={VIEWS} value={view} onChange={(id) => setView(id as ViewName)} />

          {view === 'month' ? (
            <MonthGrid
              month={selectedDay}
              selected={selectedDay}
              hasOn={hasOn}
              onSelect={setSelectedDay}
              onShift={shift}
              today={today}
            />
          ) : null}
          {view === 'week' ? (
            <WeekStrip selected={selectedDay} today={today} hasOn={hasOn} onSelect={setSelectedDay} onShift={shift} />
          ) : null}

          <AgendaList
            view={view}
            selected={selectedDay}
            today={today}
            todayStamp={todayStamp}
            timeZone={timeZone}
            items={items}
            pendingTaskId={pendingTaskId}
            onToggle={async (taskId, status) => {
              if (pendingTaskId) return;
              setPendingTaskId(taskId);
              try {
                await updateTaskStatus(taskId, status === 'completed' ? 'todo' : 'completed');
                await refresh();
              } finally {
                setPendingTaskId(null);
              }
            }}
            onAdd={() => router.push({ pathname: '/create-event', params: { day: dayParam } })}
            onTask={() => router.push({ pathname: '/create-task', params: { day: dayParam } })}
          />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

function buildItems(
  events: CalendarEvent[],
  tasks: Task[],
  milestones: MilestoneRow[],
  unavailable: UnavailablePeriod[],
  userId: string | undefined,
  groups: { id: string; name: string }[],
  timeZone: string,
): CalendarItem[] {
  const projectName = (id: string | null | undefined) => groups.find((group) => group.id === id)?.name || '';
  const rows: CalendarItem[] = [];
  for (const event of events) {
    if ((event.kind === 'meeting' || event.kind === 'event') && !(pickedInstant(event.ends_at, timeZone).getTime() > new Date().getTime())) continue;
    rows.push({
      key: `event-${event.id}`,
      title: event.title,
      kind: event.kind === 'meeting' ? 'meeting' : event.kind === 'deadline' ? 'deadline' : 'event',
      start: event.starts_at,
      end: event.ends_at,
      project: event.group?.name || projectName(event.group_id) || 'Project',
      location: event.location || '',
      who: '',
      href: `/event/${event.id}`,
      taskId: null,
      taskStatus: null,
      allDay: false,
    });
  }
  for (const task of tasks) {
    if (!task.due_at || task.status === 'completed' || task.skipped) continue;
    const names = (task.assignments ?? []).map((assignment) => assignment.profile?.display_name).filter((name): name is string => Boolean(name));
    const rule = parseRule(task.recurrence);
    const openDue = decodeWallClock(task.due_at);
    const dates = rule ? repeatDates(openDue, rule, task.occurrence_index ?? 0) : [openDue];
    dates.forEach((date, index) => {
      const start = encodeWallClock(date);
      rows.push({
        key: `task-${task.id}-${start}`,
        title: task.title,
        kind: 'task',
        start,
        end: start,
        project: task.group?.name || projectName(task.group_id) || 'Personal',
        location: '',
        who: names[0] || '',
        href: `/task/${task.id}`,
        taskId: index === 0 ? task.id : null,
        taskStatus: index === 0 ? task.status : null,
        allDay: false,
      });
    });
  }
  for (const milestone of milestones) {
    if (!milestone.due_on || milestone.completed_at) continue;
    rows.push({
      key: `milestone-${milestone.id}`,
      title: milestone.title,
      kind: 'milestone',
      start: milestone.due_on,
      end: milestone.due_on,
      project: projectName(milestone.group_id) || 'Project',
      location: '',
      who: '',
      href: `/group/${milestone.group_id}`,
      taskId: null,
      taskStatus: null,
      allDay: true,
    });
  }
  for (const period of unavailable) {
    if (!userId || period.user_id !== userId) continue;
    rows.push({
      key: `away-${period.id}`,
      title: period.reason || 'Unavailable',
      kind: 'unavailable',
      start: period.starts_on,
      end: period.ends_on,
      project: 'You',
      location: '',
      who: '',
      href: '/availability',
      taskId: null,
      taskStatus: null,
      allDay: true,
    });
  }
  return rows.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

function AgendaList({
  view,
  selected,
  today,
  todayStamp,
  timeZone,
  items,
  pendingTaskId,
  onToggle,
  onAdd,
  onTask,
}: {
  view: ViewName;
  selected: Date;
  today: Date;
  todayStamp: string;
  timeZone: string;
  items: CalendarItem[];
  pendingTaskId: string | null;
  onToggle: (taskId: string, status: Task['status']) => Promise<void>;
  onAdd: () => void;
  onTask: () => void;
}) {
  const { colors } = useTheme();
  const days = view === 'week'
    ? Array.from({ length: 7 }, (_, index) => addDays(weekStart(selected), index))
    : view === 'month' || !sameDay(selected, today)
      ? [selected]
      : [];
  const groups = new Map<string, CalendarItem[]>();
  const push = (stamp: string, item: CalendarItem) => {
    const list = groups.get(stamp) || [];
    list.push(item);
    groups.set(stamp, list);
  };
  if (view === 'agenda' && sameDay(selected, today)) {
    const horizon = dayStamp(addDays(parseStamp(todayStamp), 21));
    for (const item of items) {
      if (item.kind === 'unavailable' && /^\d{4}-\d{2}-\d{2}$/.test(item.start)) {
        const first = item.start > todayStamp ? item.start : todayStamp;
        const end = /^\d{4}-\d{2}-\d{2}$/.test(item.end) ? item.end : item.start;
        const last = end < horizon ? end : horizon;
        if (first <= last) {
          let cursor = parseStamp(first);
          const stop = parseStamp(last);
          while (cursor <= stop) {
            push(dayStamp(cursor), item);
            cursor = addDays(cursor, 1);
          }
        }
        continue;
      }
      const stamp = itemStamp(item.start, timeZone);
      if (!stamp) continue;
      if (item.kind === 'task' || item.kind === 'milestone') {
        if (dueHasPassed(item, timeZone, new Date())) push('overdue', item);
        else if (stamp <= horizon) push(stamp, item);
      } else if (pickedInstant(item.end, timeZone).getTime() > new Date().getTime() && stamp <= horizon) {
        push(stamp, item);
      }
    }
  } else {
    for (const day of days) {
      const stamp = dayStamp(day);
      for (const item of items) {
        if (onDay(item, day, timeZone)) push(stamp, item);
      }
      if (!groups.has(stamp)) groups.set(stamp, []);
    }
  }
  const stamps = [...groups.keys()].sort((a, b) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a.localeCompare(b)));
  const any = stamps.some((stamp) => (groups.get(stamp) || []).length);
  if (!any) {
    return (
      <View>
        <EmptyState
          compact
          title={sameDay(selected, today) ? 'Nothing coming up' : 'Nothing on this day'}
          body="Meetings, task due dates, and milestones from your projects show up here."
        />
        <Button title="Add calendar item" onPress={onAdd} />
        <Button title="Add a task" onPress={onTask} secondary />
      </View>
    );
  }
  return (
    <View>
      {stamps.map((stamp) => {
        const rows = groups.get(stamp) || [];
        if (!rows.length && stamp !== dayStamp(selected)) return null;
        return (
          <View key={stamp}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 4 }}>{headingFor(stamp, todayStamp)}</Text>
            {rows.length ? rows.map((item) => (
              <ItemRow key={item.key} item={item} timeZone={timeZone} todayStamp={todayStamp} pending={pendingTaskId === item.taskId} onToggle={onToggle} />
            )) : <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Nothing scheduled.</Text>}
          </View>
        );
      })}
    </View>
  );
}

function ItemRow({ item, timeZone, todayStamp, pending, onToggle }: { item: CalendarItem; timeZone: string; todayStamp: string; pending: boolean; onToggle: (taskId: string, status: Task['status']) => Promise<void> }) {
  const { colors } = useTheme();
  const overdue = dueHasPassed(item, timeZone, new Date());
  const open = () => {
    if (item.href === '/availability') router.push('/availability');
    else if (item.href.startsWith('/event/')) router.push(`/event/${item.href.slice(7)}`);
    else if (item.href.startsWith('/task/')) router.push(`/task/${item.href.slice(6)}`);
    else if (item.href.startsWith('/group/')) router.push(`/group/${item.href.slice(7)}`);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
      {item.taskId && item.taskStatus ? (
        <Pressable accessibilityRole="button" accessibilityLabel={item.taskStatus === 'completed' ? 'Mark not finished' : 'Mark finished'} disabled={pending} onPress={() => void onToggle(item.taskId || '', item.taskStatus || 'todo')} hitSlop={6} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={item.taskStatus === 'completed' ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={colors.primary} />
        </Pressable>
      ) : (
        <Ionicons name={kindIcon(item.kind)} size={18} color={colors.primary} />
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={`${kindLabel(item.kind)}. ${item.title}`} onPress={open} style={({ pressed }) => [{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' }, pressed && { opacity: 0.7 }]}>
        <View style={{ width: 58 }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{item.allDay ? 'All day' : formatClockFace(item.start)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: overdue ? colors.danger : colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{item.title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {kindLabel(item.kind)} · {item.project}{item.who ? ` · ${item.who}` : ''}{item.location ? ` · ${item.location}` : ''}{overdue ? ' · Overdue' : ''}
          </Text>
        </View>
        <Pill tone={item.kind === 'meeting' ? 'active' : item.kind === 'deadline' || item.kind === 'milestone' || overdue ? 'medium' : 'neutral'}>{kindLabel(item.kind)}</Pill>
      </Pressable>
    </View>
  );
}

function WeekStrip({
  selected,
  today,
  hasOn,
  onSelect,
  onShift,
}: {
  selected: Date;
  today: Date;
  hasOn: (day: Date) => boolean;
  onSelect: (day: Date) => void;
  onShift: (direction: number) => void;
}) {
  const { colors } = useTheme();
  const start = addDays(selected, -weekdayIndex(dayStamp(selected)));
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <View style={{ backgroundColor: colors.forestFill, borderRadius: 18, padding: 12, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => onShift(-1)} hitSlop={8}><Text style={{ color: colors.onForest, fontSize: 24, paddingHorizontal: 8 }}>‹</Text></Pressable>
        <Text style={{ color: colors.onForest, fontSize: 16, fontWeight: '700' }}>{selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => onShift(1)} hitSlop={8}><Text style={{ color: colors.onForest, fontSize: 24, paddingHorizontal: 8 }}>›</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {days.map((day) => {
          const chosen = sameDay(day, selected);
          const isToday = sameDay(day, today);
          return (
            <Pressable key={dayStamp(day)} accessibilityRole="button" accessibilityState={{ selected: chosen }} onPress={() => onSelect(day)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: chosen ? colors.accent : 'transparent', borderWidth: isToday && !chosen ? 1 : 0, borderColor: colors.accent }}>
              <Text style={{ color: chosen ? colors.onAccent : colors.onForest, fontSize: 13, fontWeight: '600' }}>{day.toLocaleDateString(undefined, { weekday: 'narrow' })}</Text>
              <Text style={{ color: chosen ? colors.onAccent : colors.onForest, fontSize: 13, fontWeight: '600' }}>{day.getDate()}</Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 4, backgroundColor: hasOn(day) ? (chosen ? colors.onAccent : colors.accent) : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({
  month,
  selected,
  today,
  hasOn,
  onSelect,
  onShift,
}: {
  month: Date;
  selected: Date;
  today: Date;
  hasOn: (day: Date) => boolean;
  onSelect: (day: Date) => void;
  onShift: (direction: number) => void;
}) {
  const { colors } = useTheme();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = weekdayIndex(dayStamp(first));
  const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => index - offset + 1);
  return (
    <View style={{ backgroundColor: colors.forestFill, borderRadius: 18, padding: 12, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onShift(-1)}><Text style={{ color: colors.onForest, fontSize: 24, paddingHorizontal: 8 }}>‹</Text></Pressable>
        <Text style={{ color: colors.onForest, fontSize: 16, fontWeight: '700' }}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => onShift(1)}><Text style={{ color: colors.onForest, fontSize: 24, paddingHorizontal: 8 }}>›</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => (
          <Text key={`${label}${index}`} style={{ width: '14.285%', textAlign: 'center', color: colors.onForestMuted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, index) => {
          const valid = day > 0 && day <= count;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const chosen = valid && sameDay(date, selected);
          const isToday = valid && sameDay(date, today);
          return (
            <Pressable key={index} accessibilityRole="button" disabled={!valid} accessibilityState={{ selected: chosen }} onPress={() => onSelect(date)} style={{ width: '14.285%', height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: chosen ? colors.accent : 'transparent', borderWidth: isToday && !chosen ? 1 : 0, borderColor: colors.accent }}>
              <Text style={{ color: chosen ? colors.onAccent : colors.onForest, fontSize: 13, fontWeight: '600' }}>{valid ? day : ''}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: valid && hasOn(date) ? (chosen ? colors.onAccent : colors.accent) : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return {
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginBottom: 8 },
    title: { color: colors.text, fontSize: 28, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
    range: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
    add: { marginTop: 0, minHeight: 40, paddingHorizontal: 16 },
    conflict: { color: colors.warning, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  } as const;
}
