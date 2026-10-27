import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

export function Page({ children, style, ...props }: ViewProps) {
  const { colors, space } = useTheme();
  return (
    <View
      style={[{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: 8 }, style]}
      {...props}
    >
      {children}
    </View>
  );
}

export function Title({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 16, flexShrink: 1 }}>
      <Text style={{ color: colors.text, fontSize: 30, lineHeight: 34, fontWeight: '700', letterSpacing: -0.7 }}>{children}</Text>
      {subtitle ? <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 6 }}>{subtitle}</Text> : null}
    </View>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginTop: 22, marginBottom: 8 }}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
  tone = 'default',
}: {
  children: React.ReactNode;
  style?: object;
  tone?: 'default' | 'muted' | 'ai';
}) {
  const { colors, radius } = useTheme();
  const backgroundColor = tone === 'muted' ? colors.mutedSurface : tone === 'ai' ? colors.mint : colors.surface;
  const borderColor = tone === 'ai' ? colors.accent : colors.border;
  return (
    <View style={[{ backgroundColor, padding: 16, borderRadius: radius.md, borderWidth: 1, borderColor, marginBottom: 12 }, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  secondary,
  light,
  disabled,
  busy,
  inline,
  tone = 'default',
  style,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  light?: boolean;
  disabled?: boolean;
  busy?: boolean;
  inline?: boolean;
  tone?: 'default' | 'forest';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const blocked = Boolean(disabled || busy);
  const onForest = tone === 'forest';
  const background = onForest
    ? secondary ? 'transparent' : colors.accent
    : secondary ? colors.mint : light ? colors.elevated : colors.primary;
  const pressedBackground = onForest
    ? secondary ? 'rgba(184,229,200,0.16)' : '#A4D9B8'
    : secondary ? colors.accent : light ? colors.mutedSurface : colors.primaryPressed;
  const labelColor = onForest
    ? secondary ? colors.accent : colors.onAccent
    : secondary || light ? colors.onMint : colors.primaryForeground;
  const borderWidth = onForest && secondary ? 1 : light ? 1 : 0;
  const borderColor = onForest && secondary ? colors.accent : colors.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: Boolean(busy) }}
      onPress={() => {
        if (!blocked) onPress();
      }}
      disabled={blocked}
      style={({ pressed }) => [
        {
          backgroundColor: pressed && !blocked ? pressedBackground : background,
          borderRadius: radius.sm,
          paddingHorizontal: 16,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 8,
          borderWidth,
          borderColor,
        },
        inline && { alignSelf: 'flex-start', marginTop: 0, minHeight: 40, paddingHorizontal: 14 },
        blocked && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={labelColor} /> : <Text style={{ color: labelColor, fontWeight: '700', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  onDark,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  onDark?: boolean;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: onDark ? 'rgba(255,255,255,0.1)' : colors.mutedSurface, borderRadius: radius.sm, padding: 3, marginBottom: 14 }}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [{
              flex: 1,
              minHeight: 36,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 6,
              backgroundColor: selected ? (onDark ? colors.accent : colors.surface) : pressed ? (onDark ? 'rgba(255,255,255,0.08)' : colors.border) : 'transparent',
            }]}
          >
            <Text style={{ color: selected ? (onDark ? colors.onAccent : colors.text) : (onDark ? colors.onForestMuted : colors.textSecondary), fontSize: 13, fontWeight: '700' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextButton({ title, onPress }: { title: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [{ marginTop: 4, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 2 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  name,
  onPress,
}: {
  label: string;
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [{
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.mutedSurface : 'transparent',
      }]}
    >
      <Ionicons name={name} size={22} color={colors.text} />
    </Pressable>
  );
}

export function Field({ label, onFocus, onBlur, style, ...props }: TextInputProps & { label: string }) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          {
            backgroundColor: focused ? colors.mint : colors.surface,
            borderColor: focused ? colors.primary : colors.border,
            borderWidth: 1,
            borderRadius: radius.sm,
            paddingHorizontal: 14,
            paddingVertical: 12,
            minHeight: 48,
            color: colors.text,
            fontSize: 16,
          },
          props.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

export function EmptyState({ title, body, compact }: { title: string; body: string; compact?: boolean }) {
  const { colors, radius } = useTheme();
  if (compact) {
    return (
      <View style={{ paddingVertical: 4, marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{body}</Text>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-start', paddingVertical: 16, paddingHorizontal: 14, marginTop: 8, backgroundColor: colors.mutedSurface, borderRadius: radius.md }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 20, marginTop: 4 }}>{body}</Text>
    </View>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Loading your workspace…</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginVertical: 8 }}>
      {children}
    </Text>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      onPress={onPress}
      style={({ pressed }) => [{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary : pressed ? colors.mint : colors.surface,
        paddingHorizontal: 14,
        minHeight: 40,
        justifyContent: 'center',
      }]}
    >
      <Text style={{ color: active ? colors.primaryForeground : colors.textSecondary, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export type PillTone = 'neutral' | 'high' | 'medium' | 'low' | 'blocked' | 'done' | 'active';

function pillColors(colors: AppColors, tone: PillTone): { backgroundColor: string; color: string } {
  if (tone === 'high' || tone === 'blocked') return { backgroundColor: colors.dangerBg, color: colors.danger };
  if (tone === 'medium') return { backgroundColor: colors.warningBg, color: colors.warning };
  if (tone === 'low') return { backgroundColor: colors.mutedSurface, color: colors.textSecondary };
  if (tone === 'active') return { backgroundColor: colors.infoBg, color: colors.info };
  return { backgroundColor: colors.mint, color: colors.onMint };
}

export function priorityTone(priority: string): PillTone {
  if (priority === 'high') return 'high';
  if (priority === 'medium') return 'medium';
  if (priority === 'low') return 'low';
  return 'neutral';
}

export function statusTone(status: string): PillTone {
  if (status === 'completed') return 'done';
  if (status === 'blocked') return 'blocked';
  if (status === 'in_progress') return 'active';
  return 'neutral';
}

export function Pill({ children, color, tone = 'neutral' }: { children: React.ReactNode; color?: string; tone?: PillTone }) {
  const { colors } = useTheme();
  const chosen = pillColors(colors, tone);
  const backgroundColor = color || chosen.backgroundColor;
  const ink = color === colors.dangerBg ? colors.danger : color === colors.warningBg ? colors.warning : color ? colors.onMint : chosen.color;
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor }}>
      <Text style={{ color: ink, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{children}</Text>
    </View>
  );
}

export function SelectCard({
  title,
  detail,
  selected,
  onPress,
}: {
  title: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: selected ? colors.mint : colors.surface,
        borderWidth: 1,
        borderColor: selected || pressed ? colors.primary : colors.border,
        borderRadius: radius.md,
        padding: 14,
        marginBottom: 10,
      }]}
    >
      <View style={{ paddingTop: 2 }}>
        <View style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: selected ? colors.primary : colors.textTertiary,
          backgroundColor: selected ? colors.primary : colors.surface,
        }}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        {detail ? <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 }}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

export function ProgressBar({ value, label, color }: { value: number; label?: string; color?: string }) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const [motion] = useState(() => new Animated.Value(clamped));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      motion.setValue(clamped);
      return;
    }
    Animated.timing(motion, { toValue: clamped, duration: 220, useNativeDriver: false }).start();
  }, [clamped, motion, reduceMotion]);

  const width = motion.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      {label ? <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16 }}>{label}</Text> : null}
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: clamped }} style={{ height: 7, borderRadius: 7, backgroundColor: colors.mutedSurface, overflow: 'hidden' }}>
        <Animated.View style={{ height: 7, borderRadius: 7, width, backgroundColor: color || colors.primary }} />
      </View>
    </View>
  );
}

<<<<<<< HEAD
export function AiBanner({ title, body }: { title: string; body: string }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ backgroundColor: colors.mint, borderRadius: radius.md, padding: 14, marginBottom: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <Ionicons name="sparkles" size={18} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.onMint, fontWeight: '700', fontSize: 16 }}>{title}</Text>
        <Text style={{ color: colors.onMint, marginTop: 4, lineHeight: 20, fontSize: 14, opacity: 0.85 }}>{body}</Text>
      </View>
    </View>
  );
}
=======
const styles = {
  page: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  titleWrap: {
    marginBottom: 18,
  },

  title: {
    color: theme.colors.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  subtitle: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },

  card: {
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.line,
    marginBottom: 12,
  },

  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 8,
  },

  buttonPressed: {
    backgroundColor: theme.colors.primaryDark,
  },

  buttonSecondary: {
    backgroundColor: theme.colors.mint,
  },

  buttonSecondaryPressed: {
    backgroundColor: '#D5EBE6',
  },

  buttonLight: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },

  buttonText: {
    color: theme.colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },

  buttonSecondaryText: {
    color: theme.colors.primaryDark,
  },

  buttonLightText: {
    color: theme.colors.primaryDark,
  },

  disabled: {
    opacity: 0.55,
  },

  textButton: {
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },

  textButtonPressed: {
    opacity: 0.6,
  },

  textButtonLabel: {
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 15,
  },

  field: {
    marginBottom: 12,
  },

  label: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },

  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: theme.colors.ink,
    fontSize: 15,
  },

  inputFocused: {
    borderColor: theme.colors.primary,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 28,
    marginTop: 8,
  },

  emptyMark: {
    width: 28,
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },

  section: {
    color: theme.colors.ink,
    fontSize: theme.type.section,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginTop: 16,
    marginBottom: 8,
  },

  meta: {
    color: theme.colors.muted,
    fontSize: theme.type.caption,
    lineHeight: 18,
  },

  progressWrap: {
    marginTop: 8,
    gap: 6,
  },

  track: {
    height: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.line,
    overflow: 'hidden',
  },

  fill: {
    height: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
  },

  emptyTitle: {
    color: theme.colors.ink,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },

  emptyBody: {
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 5,
    maxWidth: 270,
  },

  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: theme.colors.background,
  },

  error: {
    color: theme.colors.red,
    fontSize: 14,
    marginVertical: 8,
  },

  pill: {
    alignSelf: 'flex-start',
    borderRadius: 30,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },

  pillText: {
    color: theme.colors.primaryDark,
    fontSize: 11,
    fontWeight: '700',
  },

  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },

  chipPressed: {
    backgroundColor: theme.colors.mint,
    borderColor: theme.colors.primary,
  },

  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },

  selectCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 10,
  },

  selectCardOn: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.mint,
  },

  selectCardPressed: {
    borderColor: theme.colors.primaryDark,
  },

  selectMark: {
    paddingTop: 2,
  },

  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.faint,
    backgroundColor: theme.colors.surface,
  },

  radioOn: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },

  selectTitle: {
    color: theme.colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },

  selectDetail: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },

  chipText: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },

  chipTextActive: {
    color: theme.colors.onPrimary,
  },
} as const;
>>>>>>> c260418 (tried fixing some themes)
