import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DateField } from '@/components/DateField';
import { Chip, Field } from '@/components/ui';
import { useTheme } from '@/features/theme/ThemeProvider';
import {
  REPEAT_PRESETS,
  calendarStamp,
  emptyRule,
  parseStamp,
  presetForRule,
  ruleFromPreset,
  ruleSummary,
  weekdayLabel,
  type RecurrencePreset,
  type RecurrenceRule,
} from '@/lib/recurrence';
import type { AppColors } from '@/lib/theme';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

export function RecurrenceField({
  due,
  rule,
  onChange,
}: {
  due: Date | null;
  rule: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
}) {
  const { colors, radius } = useTheme();
  const styles = createStyles(colors, radius.sm);
  const [open, setOpen] = useState(false);
  const preset = presetForRule(rule);
  const custom = rule ?? emptyRule(due ? calendarStamp(due) : '');
  const selected = REPEAT_PRESETS.find((option) => option.id === preset)?.label ?? 'Does not repeat';

  const choose = (next: RecurrencePreset) => {
    if (!due) {
      onChange(next === 'none' ? null : emptyRule(''));
      return;
    }
    onChange(ruleFromPreset(next, due));
  };

  const update = (patch: Partial<RecurrenceRule>) => {
    const next = { ...custom, ...patch, anchor: due ? calendarStamp(due) : custom.anchor };
    onChange(next);
  };

  return (
    <View>
      <Text style={styles.label}>Repeat</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Repeat, ${selected}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.menu}
      >
        <Text style={styles.menuText}>{selected}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <View style={styles.options}>
          {REPEAT_PRESETS.map((option) => {
            const active = preset === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  choose(option.id);
                  setOpen(false);
                }}
                style={[styles.option, active && styles.optionOn]}
              >
                <Text style={[styles.optionText, active && styles.optionTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {preset === 'custom' ? (
        <View style={styles.custom}>
          <Text style={styles.hint}>Repeat every</Text>
          <Field
            label="Every"
            value={String(custom.interval)}
            onChangeText={(value) => update({ interval: Number(value.replace(/[^0-9]/g, '')) || 1 })}
            keyboardType="number-pad"
          />
          <View style={styles.row}>
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((frequency) => (
              <Chip
                key={frequency}
                label={frequency === 'daily' ? 'Days' : frequency === 'weekly' ? 'Weeks' : frequency === 'monthly' ? 'Months' : 'Years'}
                active={custom.frequency === frequency}
                onPress={() => update({
                  frequency,
                  weekdays: frequency === 'weekly' ? (custom.weekdays.length ? custom.weekdays : [due?.getDay() ?? 1]) : [],
                  monthDay: frequency === 'monthly' || frequency === 'yearly' ? (custom.monthDay || due?.getDate() || 1) : null,
                })}
              />
            ))}
          </View>
          {custom.frequency === 'weekly' ? (
            <>
              <Text style={styles.hint}>On these days</Text>
              <View style={styles.row}>
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day}
                    label={weekdayLabel(day)}
                    active={custom.weekdays.includes(day)}
                    onPress={() => update({
                      weekdays: custom.weekdays.includes(day)
                        ? custom.weekdays.filter((item) => item !== day)
                        : [...custom.weekdays, day],
                    })}
                  />
                ))}
              </View>
            </>
          ) : null}
          {custom.frequency === 'monthly' ? (
            <Field
              label="Day of the month"
              value={String(custom.monthDay || due?.getDate() || 1)}
              onChangeText={(value) => update({ monthDay: Math.min(31, Math.max(1, Number(value.replace(/[^0-9]/g, '')) || 1)) })}
              keyboardType="number-pad"
            />
          ) : null}
          <DateField
            label="End date (optional)"
            value={custom.until ? parseStamp(custom.until) : null}
            onChange={(value) => update({ until: value ? calendarStamp(value) : null })}
          />
          <Field
            label="Stop after (optional)"
            placeholder="Number of times"
            value={custom.count == null ? '' : String(custom.count)}
            onChangeText={(value) => {
              const trimmed = value.replace(/[^0-9]/g, '');
              update({ count: trimmed ? Number(trimmed) : null });
            }}
            keyboardType="number-pad"
          />
        </View>
      ) : null}
      {due && rule ? <Text style={styles.summary}>{ruleSummary(rule)}</Text> : null}
      {!due ? <Text style={styles.summary}>Add a due date to repeat this task.</Text> : null}
    </View>
  );
}

function createStyles(colors: AppColors, radius: number) {
  return {
    label: { color: colors.text, fontSize: 13, fontWeight: '700' as const, marginTop: 4, marginBottom: 8 },
    hint: { color: colors.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 6 },
    summary: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 8, marginBottom: 8 },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 7 },
    custom: { marginTop: 8 },
    menu: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    menuText: { color: colors.text, fontSize: 16, fontWeight: '600' as const },
    options: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius,
      backgroundColor: colors.surface,
      overflow: 'hidden' as const,
    },
    option: { minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 14 },
    optionOn: { backgroundColor: colors.mint },
    optionText: { color: colors.text, fontSize: 15 },
    optionTextOn: { color: colors.onMint, fontWeight: '700' as const },
  };
}
