import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
} from '@/components/ui';

import { useWorkspace } from '@/hooks/useWorkspace';
import { encodeWallClock } from '@/lib/format';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import { supabase } from '@/lib/supabase';

import type { EventKind } from '@/types/database';

const kinds: EventKind[] = ['event', 'meeting', 'deadline'];

function clockOnDay(day: string, hour: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function CreateEventScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { groups, refresh } = useWorkspace();
  const params = useLocalSearchParams<{ groupId?: string | string[]; day?: string | string[] }>();
  const openedFrom = Array.isArray(params.groupId) ? params.groupId[0] ?? '' : params.groupId ?? '';
  const openedDay = Array.isArray(params.day) ? params.day[0] ?? '' : params.day ?? '';

  const [groupId, setGroupId] = useState(openedFrom);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState<Date | null>(clockOnDay(openedDay, 9));
  const [endsAt, setEndsAt] = useState<Date | null>(clockOnDay(openedDay, 10));
  const [location, setLocation] = useState('');
  const [kind, setKind] = useState<EventKind>('event');
  const [agenda, setAgenda] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!groupId) {
      setError('Choose a project first.');
      return;
    }

    if (!title.trim()) {
      setError('Add a title.');
      return;
    }

    if (!startsAt || !endsAt) {
      setError('Choose a start and an end.');
      return;
    }

    const start = startsAt;
    const end = endsAt;

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      setError(
        'Enter valid dates and make sure the end is after the start.'
      );
      return;
    }

    setBusy(true);
    setError('');

    const group = groups.find(
      item => item.id === groupId
    );

    const { data: event, error: issue } = await supabase
      .from('events')
      .insert({
        group_id: groupId,
        title: title.trim(),
        description: kind === 'meeting' && agenda.trim() ? agenda.trim() : description.trim(),
        starts_at: encodeWallClock(start),
        ends_at: encodeWallClock(end),
        location: location.trim(),
        kind,
        color: group?.color || colors.primary,
      })
      .select('id')
      .single();

    if (issue || !event) {
      setBusy(false);
      setError(issue?.message || 'Could not add the calendar item.');
      return;
    }

    if (kind === 'meeting') {
      const meeting = await supabase.from('meetings').insert({
        group_id: groupId,
        event_id: event.id,
        title: title.trim(),
        description: description.trim(),
        agenda: agenda.trim(),
        starts_at: encodeWallClock(start),
        ends_at: encodeWallClock(end),
        location: location.trim(),
      });
      if (meeting.error) {
        setBusy(false);
        setError(`The calendar item was saved, but the meeting record failed: ${meeting.error.message}`);
        return;
      }
    }

    setBusy(false);

    await refresh();

    Alert.alert(
      'Added to calendar',
      `${title} is now on the ${group?.name || 'project'} calendar.`
    );

    router.back();
  };

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        <Text style={styles.label}>Group</Text>

        <Card style={styles.selectors}>
          {groups.map(group => (
            <Text
              key={group.id}
              onPress={() => setGroupId(group.id)}
              style={[
                styles.choice,
                groupId === group.id && styles.active,
              ]}
            >
              {group.name}
            </Text>
          ))}
        </Card>

        <Text style={styles.label}>Type</Text>

        <Card style={styles.selectors}>
          {kinds.map(value => (
            <Text
              key={value}
              onPress={() => setKind(value)}
              style={[
                styles.choice,
                kind === value && styles.active,
              ]}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Text>
          ))}
        </Card>

        <Field
          label="Title"
          placeholder="What is happening?"
          value={title}
          onChangeText={setTitle}
        />

        <Field
          label="Description"
          placeholder="Add details or an agenda"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <DateField label="Starts" mode="datetime" value={startsAt} onChange={setStartsAt} />
        <DateField label="Ends" mode="datetime" value={endsAt} onChange={setEndsAt} />
        <Text style={styles.hint}>Leave these blank to schedule a one-hour block starting in an hour.</Text>

        {kind === 'meeting' ? (
          <Field
            label="Agenda"
            value={agenda}
            onChangeText={setAgenda}
            placeholder="What should the project decide?"
            multiline
          />
        ) : null}

        <Field
          label="Location or video link"
          value={location}
          onChangeText={setLocation}
          placeholder="Optional"
        />

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button
          title={busy ? 'Saving…' : 'Add to calendar'}
          onPress={() => void create()}
          disabled={busy || !groups.length}
        />

        {!groups.length ? (
          <ErrorText>
            Create a project before adding calendar items.
          </ErrorText>
        ) : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 4,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 8,
  },

  selectors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    padding: 10,
  },

  choice: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  active: {
    color: 'white',
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
} as const;
}
