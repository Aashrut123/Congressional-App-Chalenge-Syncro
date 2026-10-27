import React, { createElement, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { formatDay } from '@/lib/planner/dates';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

type Mode = 'date' | 'time' | 'datetime';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function labelFor(value: Date | null, mode: Mode): string {
  if (!value) return mode === 'time' ? 'Choose a time' : 'Choose a date';
  if (mode === 'date') {
    return value.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  const time = value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (mode === 'time') return time;
  return `${value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

function webValue(value: Date | null, mode: Mode): string {
  if (!value) return '';
  if (mode === 'date') return formatDay(value);
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  if (mode === 'time') return time;
  return `${formatDay(value)}T${time}`;
}

export function DateField({
  label,
  value,
  onChange,
  mode = 'date',
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  mode?: Mode;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'date' | 'time'>(mode === 'time' ? 'time' : 'date');
  const [fallback] = useState(() => new Date());
  const current = value ?? fallback;

  const applyPart = (selected: Date, part: 'date' | 'time') => {
    const next = new Date(current);
    if (part === 'date') next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    onChange(next);
  };

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed' || !selected) {
      setOpen(false);
      return;
    }
    const part = mode === 'datetime' ? phase : mode === 'time' ? 'time' : 'date';
    applyPart(selected, part);
    if (mode === 'datetime' && phase === 'date') {
      setPhase('time');
      return;
    }
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'web' ? (
        createElement('input', {
          'aria-label': label,
          type: mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'datetime-local',
          value: webValue(value, mode),
          onChange: (event: { target: { value: string } }) => {
            const raw = event.target.value;
            if (!raw) {
              onChange(null);
              return;
            }
            if (mode === 'time') {
              const [hour, minute] = raw.split(':').map(Number);
              const next = new Date(current);
              next.setHours(hour, minute, 0, 0);
              onChange(next);
              return;
            }
            const [dayPart, timePart] = raw.split('T');
            const [year, month, day] = dayPart.split('-').map(Number);
            const [hour, minute] = (timePart ?? `${pad(current.getHours())}:${pad(current.getMinutes())}`).split(':').map(Number);
            onChange(new Date(year, month - 1, day, hour, minute, 0, 0));
          },
          style: {
            width: '100%',
            boxSizing: 'border-box',
            background: colors.surface,
            border: `1px solid ${colors.line}`,
            borderRadius: 11,
            padding: 12,
            color: colors.ink,
            fontSize: 15,
          },
        })
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => {
              setPhase(mode === 'time' ? 'time' : 'date');
              setOpen(true);
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{labelFor(value, mode)}</Text>
          </Pressable>
          {value ? (
            <Text style={styles.clear} onPress={() => onChange(null)}>Clear</Text>
          ) : null}
          {open && Platform.OS === 'ios' ? (
            <View>
              {mode !== 'time' ? (
                <DateTimePicker value={current} mode="date" onChange={(_event, selected) => selected && applyPart(selected, 'date')} />
              ) : null}
              {mode !== 'date' ? (
                <DateTimePicker value={current} mode="time" onChange={(_event, selected) => selected && applyPart(selected, 'time')} />
              ) : null}
              <Text style={styles.clear} onPress={() => setOpen(false)}>Done</Text>
            </View>
          ) : null}
          {open && Platform.OS === 'android' ? (
            <DateTimePicker
              value={current}
              mode={mode === 'datetime' ? phase : mode}
              onChange={onNativeChange}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return {
  wrap: { marginBottom: 12 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' as const, marginBottom: 6 },
  button: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  buttonText: { color: colors.ink, fontSize: 15 },
  clear: { color: colors.primary, fontWeight: '700' as const, marginTop: 6 },
} as const;
}

