import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button, Chip, ErrorText, Field, Page } from '@/components/ui';
import { useWorkspace } from '@/hooks/useWorkspace';
import { todayDay } from '@/lib/planner/dates';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

export default function ProgressScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const params = useLocalSearchParams<{ groupId?: string }>();
  const { groups, refresh } = useWorkspace();
  const [groupId, setGroupId] = useState(params.groupId ?? groups[0]?.id ?? '');
  const [done, setDone] = useState('');
  const [next, setNext] = useState('');
  const [blockers, setBlockers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!groupId) {
      setError('Choose a project.');
      return;
    }
    if (done.trim().length < 2) {
      setError('Write what you actually finished. The app will not invent it.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: issue } = await supabase.from('progress_logs').insert({
      group_id: groupId,
      log_date: todayDay(),
      accomplishments: done.trim(),
      next_steps: next.trim(),
      blockers: blockers.trim(),
    });
    setBusy(false);
    if (issue) {
      setError(issue.message);
      return;
    }
    await refresh();
    router.back();
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
        <Text style={styles.lead}>One to three lines is enough. Teammates see this on the project timeline.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {groups.filter((group) => group.status !== 'archived').map((group) => (
            <Chip key={group.id} label={group.name} active={group.id === groupId} onPress={() => setGroupId(group.id)} />
          ))}
        </ScrollView>
        <Field label="What I finished" value={done} onChangeText={setDone} multiline placeholder="Wired the sensor and pushed the notes" />
        <Field label="What I will do next" value={next} onChangeText={setNext} multiline placeholder="Optional" />
        <Field label="Blockers" value={blockers} onChangeText={setBlockers} multiline placeholder="Optional" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button title={busy ? 'Posting…' : 'Post update'} onPress={() => void submit()} disabled={busy} />
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  lead: { color: colors.muted, lineHeight: 20, marginBottom: 12 },
  row: { gap: 8, paddingBottom: 12 },
} as const;
}

