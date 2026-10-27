import { supabase } from '@/lib/supabase';
import type {
  AppNotification,
  AvailabilityWindow,
  CalendarEvent,
  Group,
  ProgressLog,
  Task,
  UnavailablePeriod,
} from '@/types/database';

interface MembershipGroupRow {
  group: Group | Group[] | null;
}

function oneGroup(value: Group | Group[] | null): Group | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function loadGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from('group_memberships')
    .select('group:groups(*)')
    .order('joined_at', { ascending: false });
  if (error) throw error;
  const uniqueGroups = new Map<string, Group>();
  for (const row of (data ?? []) as MembershipGroupRow[]) {
    const group = oneGroup(row.group);
    if (group && !uniqueGroups.has(group.id)) uniqueGroups.set(group.id, group);
  }
  return Array.from(uniqueGroups.values());
}

export async function loadEvents(groupId?: string): Promise<CalendarEvent[]> {
  const since = new Date();
  since.setDate(since.getDate() - 120);
  let query = supabase
    .from('events')
    .select('*, group:groups(id,name,color)')
    .gte('ends_at', since.toISOString())
    .order('starts_at');
  if (groupId) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function loadTasks(groupId?: string): Promise<Task[]> {
  let query = supabase
    .from('tasks')
    .select('*, group:groups(id,name,color), assignments:task_assignments(user_id, profile:profiles(display_name))')
    .order('created_at', { ascending: false });
  if (groupId) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function loadProgressLogs(): Promise<ProgressLog[]> {
  const { data, error } = await supabase
    .from('progress_logs')
    .select('*, profile:profiles(id,display_name,avatar_url), group:groups(id,name)')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ProgressLog[];
}

export async function loadNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function loadAvailability(): Promise<{
  windows: AvailabilityWindow[];
  unavailable: UnavailablePeriod[];
}> {
  const [windows, unavailable] = await Promise.all([
    supabase.from('availability_windows').select('*').order('weekday'),
    supabase.from('unavailable_periods').select('*').order('starts_on'),
  ]);
  if (windows.error) throw windows.error;
  if (unavailable.error) throw unavailable.error;
  return {
    windows: (windows.data ?? []) as AvailabilityWindow[],
    unavailable: (unavailable.data ?? []) as UnavailablePeriod[],
  };
}

export function subscribeToGroupData(onChange: () => void) {
  const channel = supabase
    .channel(`groupsync-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_memberships' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_logs' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
