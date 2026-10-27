import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { DateField } from '@/components/DateField';
import { Button, Card, Chip, ErrorText, Field, Loading, Page } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDay } from '@/lib/planner/dates';
import { formatAvailabilityWindow } from '@/lib/availability';
import { DEFAULT_TIME_ZONE, preferredTimeZone, timezoneLabel } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type { AvailabilityWindow, UnavailablePeriod } from '@/types/database';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function label(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export default function AvailabilityScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, profile } = useAuth();
  const timeZone = preferredTimeZone(profile?.timezone || DEFAULT_TIME_ZONE);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [blocks, setBlocks] = useState<UnavailablePeriod[]>([]);
  const [teammates, setTeammates] = useState<{ id: string; name: string; windows: AvailabilityWindow[]; away: UnavailablePeriod[] }[]>([]);
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState<Date | null>(() => {
    const date = new Date();
    date.setHours(16, 0, 0, 0);
    return date;
  });
  const [end, setEnd] = useState<Date | null>(() => {
    const date = new Date();
    date.setHours(19, 0, 0, 0);
    return date;
  });
  const [awayStart, setAwayStart] = useState<Date | null>(null);
  const [awayEnd, setAwayEnd] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const [windowResult, blockResult, peopleResult] = await Promise.all([
      supabase.from('availability_windows').select('*').order('weekday'),
      supabase.from('unavailable_periods').select('*').order('starts_on'),
      supabase.from('group_memberships').select('user_id, profile:profiles(display_name)'),
    ]);
    if (windowResult.error || blockResult.error) {
      setError(windowResult.error?.message || blockResult.error?.message || 'Could not load availability.');
    }
    const allWindows = (windowResult.data ?? []) as AvailabilityWindow[];
    const allBlocks = (blockResult.data ?? []) as UnavailablePeriod[];
    setWindows(allWindows.filter((window) => window.user_id === user.id));
    setBlocks(allBlocks.filter((block) => block.user_id === user.id));
    const names = new Map<string, string>();
    for (const row of (peopleResult.error ? [] : peopleResult.data ?? []) as { user_id: string; profile?: { display_name?: string } | null }[]) {
      if (row.user_id === user.id || names.has(row.user_id)) continue;
      names.set(row.user_id, row.profile?.display_name?.trim() || 'Teammate');
    }
    setTeammates([...names.entries()].map(([id, name]) => ({
      id,
      name,
      windows: allWindows.filter((window) => window.user_id === id),
      away: allBlocks.filter((block) => block.user_id === id),
    })).sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const addWindow = async () => {
    if (!start || !end) {
      setError('Choose a start and end time.');
      return;
    }
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const endMinute = end.getHours() * 60 + end.getMinutes();
    if (endMinute <= startMinute) {
      setError('The end time has to be after the start.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('availability_windows').insert({
      weekday,
      start_minute: startMinute,
      end_minute: endMinute,
    });
    setBusy(false);
    if (issue) setError(issue.message);
    else await load();
  };

  const addAway = async () => {
    if (!awayStart || !awayEnd || formatDay(awayEnd) < formatDay(awayStart)) {
      setError('Choose a first and last day, with the last day on or after the first.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('unavailable_periods').insert({
      starts_on: formatDay(awayStart),
      ends_on: formatDay(awayEnd),
      reason: reason.trim(),
    });
    setBusy(false);
    if (issue) setError(issue.message);
    else {
      setReason('');
      await load();
    }
  };

  const removeWindow = async (id: string) => {
    const { error: issue } = await supabase.from('availability_windows').delete().eq('id', id);
    if (issue) setError(issue.message);
    else await load();
  };

  const removeBlock = async (id: string) => {
    const { error: issue } = await supabase.from('unavailable_periods').delete().eq('id', id);
    if (issue) setError(issue.message);
    else await load();
  };

  if (loading) return <Loading />;

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
        <Text style={styles.lead}>Weekly hours and away dates are in {timezoneLabel(timeZone)} time.</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Text style={styles.heading}>Weekly windows</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          {days.map((day, index) => (
            <Chip key={day} label={day} active={weekday === index} onPress={() => setWeekday(index)} />
          ))}
        </ScrollView>
        <DateField label="Starts" mode="time" value={start} onChange={setStart} />
        <DateField label="Ends" mode="time" value={end} onChange={setEnd} />
        <Button title={busy ? 'Saving…' : 'Add window'} onPress={() => void addWindow()} disabled={busy} />
        {windows.map((window) => (
          <Card key={window.id}>
            <Text style={styles.item}>{days[window.weekday]} · {label(window.start_minute)}–{label(window.end_minute)}</Text>
            <Text style={styles.remove} onPress={() => void removeWindow(window.id)}>Remove</Text>
          </Card>
        ))}
        <Text style={styles.heading}>Away dates</Text>
        <DateField label="First day away" value={awayStart} onChange={setAwayStart} />
        <DateField label="Last day away" value={awayEnd} onChange={setAwayEnd} />
        <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Optional, such as exams or travel" />
        <Button title="Add unavailable period" onPress={() => void addAway()} disabled={busy} secondary />
        {blocks.map((block) => (
          <Card key={block.id}>
            <Text style={styles.item}>{block.starts_on} to {block.ends_on}</Text>
            <Text style={styles.note}>{block.reason || 'Unavailable'}</Text>
            <Text style={styles.remove} onPress={() => void removeBlock(block.id)}>Remove</Text>
          </Card>
        ))}
        <Text style={styles.heading}>Teammates</Text>
        <Text style={styles.note}>People who share a project with you. You can see their hours. Only they can change them.</Text>
        {teammates.length ? teammates.map((person) => (
          <Card key={person.id}>
            <Text style={styles.item}>{person.name}</Text>
            {person.windows.length ? person.windows.map((window) => (
              <Text key={window.id} style={styles.note}>{formatAvailabilityWindow(window.weekday, window.start_minute, window.end_minute)}</Text>
            )) : <Text style={styles.note}>No weekly hours saved.</Text>}
            {person.away.map((block) => (
              <Text key={block.id} style={styles.note}>{block.starts_on} to {block.ends_on}{block.reason ? ` · ${block.reason}` : ''}</Text>
            ))}
          </Card>
        )) : <Text style={styles.note}>No teammates yet.</Text>}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  lead: { color: colors.muted, lineHeight: 20, marginBottom: 12 },
  heading: { color: colors.ink, fontSize: 17, fontWeight: '800' as const, marginTop: 8, marginBottom: 8 },
  days: { gap: 8, paddingBottom: 8 },
  item: { color: colors.ink, fontWeight: '700' as const },
  note: { color: colors.muted, marginTop: 4 },
  remove: { color: colors.red, fontWeight: '700' as const, marginTop: 8 },
} as const;
}

