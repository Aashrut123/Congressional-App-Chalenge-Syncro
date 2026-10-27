import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { DateField } from '@/components/DateField';
import { Button, Card, Chip, ErrorText, Field, Loading, Page, Pill } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { refreshWorkspace } from '@/hooks/useWorkspace';
import { decodeWallClock, encodeWallClock, formatClockFace, formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';
import type { AttendeeResponse, CalendarEvent, EventKind, Meeting, MeetingAttendee } from '@/types/database';

const kinds: EventKind[] = ['event', 'meeting', 'deadline'];
const responses: { value: AttendeeResponse; label: string }[] = [
  { value: 'accepted', label: 'Going' },
  { value: 'declined', label: "Can't go" },
  { value: 'invited', label: 'Invited' },
];

type Person = {
  user_id: string;
  profile?: { display_name: string } | null;
};

function asProfile(profile: { display_name: string } | { display_name: string }[] | null): { display_name: string } | null {
  const row = Array.isArray(profile) ? profile[0] : profile;
  return row ?? null;
}

export default function EventDetailScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agenda, setAgenda] = useState('');
  const [notes, setNotes] = useState('');
  const [actions, setActions] = useState('');
  const [location, setLocation] = useState('');
  const [kind, setKind] = useState<EventKind>('event');
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: issue } = await supabase.from('events').select('*, group:groups(id,name,color)').eq('id', id).single();
    if (issue || !data) {
      setError(issue?.message || 'Calendar item not found.');
      setEvent(null);
      setLoading(false);
      return;
    }
    const value = data as CalendarEvent;
    const [{ data: membership }, { data: meetingRow }, { data: members }] = await Promise.all([
      supabase.from('group_memberships').select('role').eq('group_id', value.group_id).eq('user_id', user?.id || '').maybeSingle(),
      supabase.from('meetings').select('*').eq('event_id', value.id).maybeSingle(),
      supabase.from('group_memberships').select('user_id, profile:profiles(display_name)').eq('group_id', value.group_id),
    ]);
    const loadedMeeting = (meetingRow as Meeting | null) ?? null;
    let loadedAttendees: MeetingAttendee[] = [];
    if (loadedMeeting) {
      const attendeeResult = await supabase
        .from('meeting_attendees')
        .select('meeting_id, user_id, response, profile:profiles(display_name)')
        .eq('meeting_id', loadedMeeting.id);
      if (attendeeResult.error) setError(attendeeResult.error.message);
      loadedAttendees = (attendeeResult.data || []).map((row) => ({
        meeting_id: row.meeting_id,
        user_id: row.user_id,
        response: row.response as AttendeeResponse,
        profile: asProfile(row.profile) ?? undefined,
      }));
    }
    setEvent(value);
    setMeeting(loadedMeeting);
    setPeople((members || []).map((row) => ({ user_id: row.user_id, profile: asProfile(row.profile) })));
    setAttendees(loadedAttendees);
    setTitle(value.title);
    setDescription(value.description);
    setAgenda(loadedMeeting?.agenda || '');
    setNotes(loadedMeeting?.notes || '');
    setActions(loadedMeeting?.action_items || '');
    setLocation(value.location);
    setKind(value.kind);
    setStartsAt(decodeWallClock(value.starts_at));
    setEndsAt(decodeWallClock(value.ends_at));
    const member = Boolean(membership) || value.created_by === user?.id;
    setCanEdit(member);
    setCanDelete(member);
    setLoading(false);
  }, [id, user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (loading) return <Loading />;
  if (!event) {
    return (
      <Page>
        <ErrorText>{error || 'Calendar item not found.'}</ErrorText>
      </Page>
    );
  }

  const nameFor = (userId: string, profile?: { display_name: string } | null) =>
    profile?.display_name || people.find((person) => person.user_id === userId)?.profile?.display_name || 'Teammate';

  const save = async () => {
    if (!title.trim() || !startsAt || !endsAt || endsAt <= startsAt) {
      setError('Add a title and make sure the end is after the start.');
      return;
    }
    setBusy(true);
    setError('');
    const eventUpdate = await supabase
      .from('events')
      .update({
        title: title.trim(),
        description: description.trim(),
        starts_at: encodeWallClock(startsAt),
        ends_at: encodeWallClock(endsAt),
        location: location.trim(),
        kind,
      })
      .eq('id', event.id);
    if (eventUpdate.error) {
      setBusy(false);
      setError(eventUpdate.error.message);
      return;
    }
    if (kind === 'meeting' || meeting) {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        agenda: agenda.trim(),
        notes: notes.trim(),
        action_items: actions.trim(),
        starts_at: encodeWallClock(startsAt),
        ends_at: encodeWallClock(endsAt),
        location: location.trim(),
      };
      const meetingWrite = meeting
        ? await supabase.from('meetings').update(payload).eq('id', meeting.id)
        : await supabase.from('meetings').insert({ ...payload, group_id: event.group_id, event_id: event.id });
      if (meetingWrite.error) {
        setBusy(false);
        setError(meetingWrite.error.message);
        return;
      }
    }
    setBusy(false);
    await load();
  };

  const remove = () => {
    Alert.alert(kind === 'meeting' ? 'Delete meeting?' : 'Delete calendar item?', 'This removes it from the shared calendar.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (meeting) {
            const meetingDelete = await supabase.from('meetings').delete().eq('id', meeting.id).select('id');
            if (meetingDelete.error) {
              setError(meetingDelete.error.message);
              return;
            }
            if (!meetingDelete.data?.length) {
              setError('The meeting was not deleted.');
              return;
            }
          }
          const { data, error: issue } = await supabase.from('events').delete().eq('id', event.id).select('id');
          if (issue) setError(issue.message);
          else if (!data?.length) setError('The calendar item was not deleted.');
          else {
            await refreshWorkspace();
            router.back();
          }
        },
      },
    ]);
  };

  const setResponse = async (userId: string, response: AttendeeResponse) => {
    if (busy) return;
    if (!meeting) {
      setError('Save this item as a meeting before adding people.');
      return;
    }
    setBusy(true);
    setError('');
    const existing = attendees.some((attendee) => attendee.user_id === userId);
    const result = existing
      ? await supabase.from('meeting_attendees').update({ response }).eq('meeting_id', meeting.id).eq('user_id', userId)
      : await supabase.from('meeting_attendees').insert({ meeting_id: meeting.id, user_id: userId, response });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else await load();
  };

  const removeAttendee = async (userId: string) => {
    if (!meeting) return;
    setBusy(true);
    const result = await supabase.from('meeting_attendees').delete().eq('meeting_id', meeting.id).eq('user_id', userId);
    setBusy(false);
    if (result.error) setError(result.error.message);
    else await load();
  };

  const invitedIds = new Set(attendees.map((attendee) => attendee.user_id));
  const uninvited = people.filter((person) => !invitedIds.has(person.user_id));
  const responseLabel = (response: AttendeeResponse) => responses.find((option) => option.value === response)?.label || response;

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.meta}>
              {event.group?.name || 'Project'} · {formatDate(event.starts_at, { timeZone: 'UTC' })} · {formatClockFace(event.starts_at)}
            </Text>
            <Pill>{kind}</Pill>
          </View>
        </View>

        {canEdit ? (
          <>
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field label="Description" value={description} onChangeText={setDescription} multiline />
            <Text style={styles.heading}>Type</Text>
            <View style={styles.row}>
              {kinds.map((value) => (
                <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={kind === value} onPress={() => setKind(value)} />
              ))}
            </View>
            <DateField label="Starts" mode="datetime" value={startsAt} onChange={setStartsAt} />
            <DateField label="Ends" mode="datetime" value={endsAt} onChange={setEndsAt} />
            <Field label="Location or video link" value={location} onChangeText={setLocation} placeholder="Optional" />
          </>
        ) : (
          <Card>
            <Text style={styles.title}>{event.title}</Text>
            <Text style={styles.body}>{event.description || 'No description.'}</Text>
            <Text style={styles.body}>
              {formatDate(event.starts_at, { timeZone: 'UTC' })} · {formatClockFace(event.starts_at)} to {formatClockFace(event.ends_at)}
            </Text>
            {event.location ? <Text style={styles.body}>{event.location}</Text> : null}
          </Card>
        )}

        {kind === 'meeting' ? (
          <>
            <Text style={styles.heading}>Agenda</Text>
            {canEdit ? (
              <Field label="What the project should cover" value={agenda} onChangeText={setAgenda} multiline placeholder="Decisions, demos, or questions" />
            ) : (
              <Card>
                <Text style={styles.body}>{agenda || 'No agenda yet.'}</Text>
              </Card>
            )}
            <Text style={styles.heading}>Notes</Text>
            {canEdit ? (
              <>
                <Field label="What was decided" value={notes} onChangeText={setNotes} multiline placeholder="Optional until the meeting happens" />
                <Field label="Follow-ups" value={actions} onChangeText={setActions} multiline placeholder="One next step per line" />
              </>
            ) : (
              <Card>
                <Text style={styles.body}>{notes || 'No notes yet.'}</Text>
                {actions ? <Text style={styles.body}>{actions}</Text> : null}
              </Card>
            )}
            <Text style={styles.heading}>Who is coming</Text>
            {meeting ? (
              <>
                {attendees.length ? (
                  attendees.map((attendee) => {
                    const mine = attendee.user_id === user?.id;
                    const canChange = mine || canEdit;
                    return (
                      <Card key={attendee.user_id}>
                        <Text style={styles.person}>{nameFor(attendee.user_id, attendee.profile)}</Text>
                        {canChange ? (
                          <View style={styles.row}>
                            {responses.map((option) => (
                              <Chip
                                key={option.value}
                                label={option.label}
                                active={attendee.response === option.value}
                                onPress={() => void setResponse(attendee.user_id, option.value)}
                              />
                            ))}
                          </View>
                        ) : (
                          <Pill>{responseLabel(attendee.response)}</Pill>
                        )}
                        {canChange ? (
                          <Text onPress={() => void removeAttendee(attendee.user_id)} style={styles.remove}>
                            Remove
                          </Text>
                        ) : null}
                      </Card>
                    );
                  })
                ) : (
                  <Card>
                    <Text style={styles.body}>Nobody is on the list yet.</Text>
                  </Card>
                )}
                {uninvited.length ? (
                  <>
                    <Text style={styles.subhead}>Add a teammate</Text>
                    <View style={styles.row}>
                      {uninvited.map((person) => (
                        <Chip
                          key={person.user_id}
                          label={person.profile?.display_name || 'Teammate'}
                          onPress={() => void setResponse(person.user_id, person.user_id === user?.id ? 'accepted' : 'invited')}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <Card>
                <Text style={styles.body}>Save this item to open the attendee list.</Text>
              </Card>
            )}
          </>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}
        {canEdit ? <Button title={busy ? 'Saving…' : 'Save changes'} onPress={() => void save()} disabled={busy} /> : null}
        {canDelete ? <Button title={kind === 'meeting' ? 'Delete meeting' : 'Delete item'} danger onPress={remove} /> : null}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 12 },
  meta: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  delete: { color: colors.red, fontWeight: '800' as const, padding: 8 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '800' as const },
  body: { color: colors.muted, lineHeight: 20, marginTop: 6 },
  heading: { color: colors.ink, fontSize: 17, fontWeight: '800' as const, marginTop: 18, marginBottom: 8 },
  subhead: { color: colors.muted, fontWeight: '700' as const, marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  person: { color: colors.ink, fontWeight: '700' as const, marginBottom: 8 },
  remove: { color: colors.red, fontWeight: '700' as const, marginTop: 8 },
} as const;
}

