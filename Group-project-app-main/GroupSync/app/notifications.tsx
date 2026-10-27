import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';

import { Button, Card, EmptyState, Page } from '@/components/ui';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type { AppNotification } from '@/types/database';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { notifications, refresh } = useWorkspace();
  const { refreshControl } = usePullRefresh(refresh);
  const [error, setError] = useState('');

  const open = async (item: AppNotification) => {
    if (!item.read_at) {
      const { error: issue } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
      if (issue) setError(issue.message);
      else await refresh();
    }
    if (item.href.startsWith('/task/') || item.href.startsWith('/group/') || item.href.startsWith('/event/')) {
      router.push(item.href as '/task/[id]' | '/group/[id]' | '/event/[id]');
    }
  };

  const markAll = async () => {
    const unread = notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (!unread.length) return;
    const { error: issue } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread);
    if (issue) setError(issue.message);
    else await refresh();
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }} refreshControl={refreshControl}>
        <Text style={styles.lead}>This list stays inside Syncro. Phone alerts for due tasks and upcoming meetings are turned on from Profile.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notifications.length ? notifications.map((item) => (
          <Card key={item.id}>
            <Text onPress={() => void open(item)} style={[styles.title, !item.read_at && styles.unread]}>{item.title}</Text>
            <Text onPress={() => void open(item)} style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>{formatDate(item.created_at)}{item.read_at ? '' : ' · New'}</Text>
          </Card>
        )) : (
          <EmptyState title="No notices yet" body="Assignments, progress logs, and new or moved meetings will show up here." />
        )}
        {notifications.some((item) => !item.read_at) ? <Button title="Mark all read" onPress={() => void markAll()} secondary /> : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  lead: { color: colors.muted, lineHeight: 20, marginBottom: 12 },
  title: { color: colors.ink, fontWeight: '700' as const, fontSize: 15 },
  unread: { fontWeight: '800' as const },
  body: { color: colors.muted, marginTop: 4, lineHeight: 18 },
  meta: { color: colors.faint, marginTop: 6, fontSize: 12 },
  error: { color: colors.red, marginBottom: 8 },
} as const;
}

