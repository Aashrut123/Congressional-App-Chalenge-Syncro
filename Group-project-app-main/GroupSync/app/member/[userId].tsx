import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button, Card, ErrorText, Loading, Page } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatAvailabilityWindow } from '@/lib/availability';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type { AvailabilityWindow, UnavailablePeriod } from '@/types/database';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function MemberAvailabilityScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = firstParam(params.userId);
  const name = firstParam(params.name) || 'Teammate';
  const { user } = useAuth();
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [away, setAway] = useState<UnavailablePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mine = user?.id === userId;

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setError('This profile could not be opened.');
      return;
    }
    const [windowResult, awayResult] = await Promise.all([
      supabase.from('availability_windows').select('*').eq('user_id', userId).order('weekday'),
      supabase.from('unavailable_periods').select('*').eq('user_id', userId).order('starts_on'),
    ]);
    if (windowResult.error || awayResult.error) {
      setError(windowResult.error?.message || awayResult.error?.message || 'Could not load availability.');
    }
    setWindows((windowResult.data ?? []) as AvailabilityWindow[]);
    setAway((awayResult.data ?? []) as UnavailablePeriod[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (loading) return <Loading />;

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.lead}>{mine ? 'Your saved hours.' : 'Hours this teammate saved. Only they can change them.'}</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Text style={styles.heading}>Weekly hours</Text>
        {windows.length ? windows.map((window) => (
          <Card key={window.id}>
            <Text style={styles.item}>{formatAvailabilityWindow(window.weekday, window.start_minute, window.end_minute)}</Text>
          </Card>
        )) : <Text style={styles.lead}>No weekly hours saved.</Text>}
        <Text style={styles.heading}>Away dates</Text>
        {away.length ? away.map((block) => (
          <Card key={block.id}>
            <Text style={styles.item}>{block.starts_on} to {block.ends_on}</Text>
            <Text style={styles.lead}>{block.reason || 'Unavailable'}</Text>
          </Card>
        )) : <Text style={styles.lead}>No away dates saved.</Text>}
        {mine ? <Button title="Edit your hours" onPress={() => router.push('/availability')} /> : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
    name: { color: colors.ink, fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
    lead: { color: colors.muted, lineHeight: 20, marginTop: 6, marginBottom: 8 },
    heading: { color: colors.ink, fontSize: 17, fontWeight: '800' as const, marginTop: 12, marginBottom: 8 },
    item: { color: colors.ink, fontWeight: '700' as const },
  } as const;
}
