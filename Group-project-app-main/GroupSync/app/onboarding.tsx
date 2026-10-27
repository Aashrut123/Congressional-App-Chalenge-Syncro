import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { Button, Chip, ErrorText, Field, Page, SelectCard, TextButton } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { GOAL_PRESETS, PLANNING_STYLES, goalSummary, type PlanningStyle } from '@/lib/goals';
import { easeLayout, usePrefersReducedMotion } from '@/lib/motion';
import { setPhoneAlerts } from '@/lib/phoneAlerts';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

type StartPath = 'start' | 'join' | 'explore';

const FEATURES: { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { title: 'Projects and shared plans', body: 'Keep a team’s tasks and milestones in one place.', icon: 'folder-open-outline' },
  { title: 'Tasks and progress', body: 'See what is left, who owns it, and what is finished.', icon: 'checkmark-circle-outline' },
  { title: 'Meetings and calendar', body: 'Deadlines and meetings stay on one schedule.', icon: 'calendar-outline' },
  { title: 'Team collaboration', body: 'Read what teammates finished and what they are doing next.', icon: 'people-outline' },
];

interface Draft {
  step: number;
  style: PlanningStyle;
  path: StartPath;
  name: string;
  code: string;
  alerts: boolean;
  goals: string[];
  customGoal: string;
}

function storageKey(userId: string) {
  return `groupsync-onboarding:${userId}`;
}

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { user, profile, refreshProfile } = useAuth();
  const reduceMotion = usePrefersReducedMotion();
  const needsName = !profile?.display_name?.trim();
  const [ready, setReady] = useState(editing);
  const [step, setStep] = useState(editing ? 1 : 0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [style, setStyle] = useState<PlanningStyle>(profile?.planning_style ?? 'steady');
  const [alerts, setAlerts] = useState(false);
  const [path, setPath] = useState<StartPath>('explore');
  const [code, setCode] = useState('');
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? []);
  const [customGoal, setCustomGoal] = useState(profile?.custom_goal ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exitTo, setExitTo] = useState<{ path: StartPath; groupId: string } | null>(null);

  const goTo = (next: number) => {
    easeLayout(reduceMotion);
    setError('');
    setStep(next);
  };

  useEffect(() => {
    if (!exitTo || profile?.onboarding_completed !== true) return;
    if (exitTo.path === 'start') {
      router.replace('/(tabs)');
      const timer = setTimeout(() => router.push('/create-group'), 0);
      return () => clearTimeout(timer);
    }
    if (exitTo.path === 'join') {
      router.replace(exitTo.groupId ? `/group/${exitTo.groupId}` : '/(tabs)');
      return;
    }
    router.replace('/(tabs)');
  }, [exitTo, profile?.onboarding_completed]);

  useEffect(() => {
    if (!user || editing) return;
    let active = true;
    void AsyncStorage.getItem(storageKey(user.id)).then((raw) => {
      if (!active || !raw) {
        if (active) setReady(true);
        return;
      }
      try {
        const saved = JSON.parse(raw) as Partial<Draft>;
        if (saved.step === 0 || saved.step === 1 || saved.step === 2) setStep(saved.step);
        if (saved.step === 3) setStep(2);
        if (saved.style === 'steady' || saved.style === 'sprint' || saved.style === 'flexible') setStyle(saved.style);
        if (saved.path === 'start' || saved.path === 'join' || saved.path === 'explore') setPath(saved.path);
        if (typeof saved.name === 'string') setName(saved.name);
        if (typeof saved.code === 'string') setCode(saved.code);
        if (typeof saved.alerts === 'boolean') setAlerts(saved.alerts);
        if (Array.isArray(saved.goals)) setGoals(saved.goals.filter((id) => typeof id === 'string').slice(0, 8));
        if (typeof saved.customGoal === 'string') setCustomGoal(saved.customGoal);
      } catch {
        // A broken draft should not block onboarding.
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [user, editing]);

  useEffect(() => {
    if (!user || editing || !ready) return;
    const draft: Draft = { step, style, path, name, code, alerts, goals, customGoal };
    void AsyncStorage.setItem(storageKey(user.id), JSON.stringify(draft));
  }, [user, editing, ready, step, style, path, name, code, alerts, goals, customGoal]);

  const saveProfile = async (completed: boolean) => {
    if (!user) return 'Sign in again to save your choices.';
    const update: {
      goals: string[];
      custom_goal: string;
      planning_style: PlanningStyle;
      display_name?: string;
      onboarding_completed?: boolean;
    } = {
      goals,
      custom_goal: customGoal.trim(),
      planning_style: style,
    };
    if (needsName && name.trim()) update.display_name = name.trim().slice(0, 80);
    if (completed) update.onboarding_completed = true;
    const { error: issue } = await supabase.from('profiles').update(update).eq('id', user.id);
    if (!issue) return '';
    return issue.message.includes('goals') || issue.message.includes('onboarding') || issue.message.includes('planning_style')
      ? 'Run the latest SQL migration in Supabase, then try again.'
      : issue.message;
  };

  const complete = async () => {
    const message = await saveProfile(true);
    if (message) return message;
    if (alerts) await setPhoneAlerts(true);
    if (user) await AsyncStorage.removeItem(storageKey(user.id));
    const saved = await refreshProfile();
    if (!saved?.onboarding_completed) return 'Setup did not finish. Try again.';
    return '';
  };

  const openApp = async (next: StartPath) => {
    if (!user) {
      router.replace('/auth');
      return;
    }
    if (needsName && !name.trim()) {
      setError('Add the name teammates should see, or go back and add it.');
      setStep(1);
      return;
    }
    setBusy(true);
    setError('');
    const message = await complete();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setExitTo({ path: next, groupId: '' });
  };

  const joinTeam = async () => {
    if (!code.trim()) {
      setError('Paste an invitation code, or choose Explore first.');
      return;
    }
    if (!user) {
      router.replace('/auth');
      return;
    }
    setBusy(true);
    setError('');
    const joined = await supabase.rpc('join_group_with_code', { invitation_code: code.trim() });
    if (joined.error) {
      setBusy(false);
      setError(joined.error.message);
      return;
    }
    const message = await complete();
    setBusy(false);
    if (message) {
      setError(`${message} You are already in the project. Choose Explore to finish.`);
      return;
    }
    const groupId = typeof joined.data === 'string' ? joined.data : '';
    setExitTo({ path: 'join', groupId });
  };

  const toggleGoal = (id: string) => {
    setGoals((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 8) return current;
      return [...current, id];
    });
  };

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <Page><Text style={styles.body}>Loading your setup…</Text></Page>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {editing ? null : (
            <View style={styles.progress}>
              {[0, 1, 2].map((value) => <View key={value} style={[styles.bar, value <= step && styles.barOn]} />)}
            </View>
          )}
          {editing ? null : <Text style={styles.step}>Step {step + 1} of 3</Text>}

          {step === 0 && !editing ? (
            <>
              <View style={styles.hero}>
                <Text style={[styles.kicker, { color: colors.accent }]}>Syncro</Text>
                <Text style={styles.heroTitle}>Team work, with a clear next step.</Text>
                <Text style={styles.heroBody}>Plan a project with other people, keep deadlines in one calendar, and see what each person finished.</Text>
              </View>
              <Text style={styles.exampleLabel}>Example, not your data</Text>
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>Robotics notebook</Text>
                <Text style={styles.note}>Milestone · Working prototype</Text>
                <View style={styles.previewRow}>
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                  <Text style={styles.previewDone}>Compare the core flow</Text>
                </View>
                <View style={styles.previewRow}>
                  <Ionicons name="ellipse-outline" size={16} color={colors.primary} />
                  <Text style={styles.previewTask}>Record a two-minute walkthrough</Text>
                  <Text style={styles.previewWhen}>Today</Text>
                </View>
              </View>
              <View style={styles.featureGrid}>
                {FEATURES.map((feature) => (
                  <View key={feature.title} style={styles.feature}>
                    <Ionicons name={feature.icon} size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureTitle}>{feature.title}</Text>
                      <Text style={styles.note}>{feature.body}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={styles.note}>You can create a project from a goal, or revise a project that already exists. Nothing is saved until you approve the draft.</Text>
              <Button title="Get started" onPress={() => goTo(1)} />
              {user ? null : <Button title="Sign in" onPress={() => router.replace('/auth')} secondary />}
            </>
          ) : null}

          {step === 1 && !editing ? (
            <>
              <Text style={styles.title}>A few details, only if they help.</Text>
              <Text style={styles.body}>Skip anything you do not want to set. You can change these later in Profile.</Text>
              {needsName ? (
                <Field label="Display name" value={name} onChangeText={setName} placeholder="How teammates know you" maxLength={80} autoCapitalize="words" />
              ) : (
                <Text style={styles.note}>We’ll use {profile?.display_name?.trim()} as your name. Change it later in Profile.</Text>
              )}
              <Text style={styles.section}>Planning pace</Text>
              <Text style={styles.note}>Optional. This only changes how the built-in planner spaces work. It does not hide any part of the app.</Text>
              <View style={styles.choices}>
                {PLANNING_STYLES.map((item) => (
                  <Chip key={item.id} label={item.label} active={style === item.id} onPress={() => setStyle(item.id)} />
                ))}
              </View>
              <Text style={styles.note}>{PLANNING_STYLES.find((item) => item.id === style)?.detail}</Text>
              <Text style={styles.section}>Reminders</Text>
              <Text style={styles.note}>Optional. Phone alerts can remind you before a task is due and before a meeting starts.</Text>
              <Chip label={alerts ? 'Alerts on' : 'Alerts off'} active={alerts} onPress={() => setAlerts((current) => !current)} />
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button title="Continue" onPress={() => {
                if (needsName && !name.trim()) {
                  setError('Add a display name, or it can wait if you already have one.');
                  return;
                }
                goTo(2);
              }} />
              <Button title="Skip for now" onPress={() => goTo(2)} secondary />
              <TextButton title="Back" onPress={() => goTo(0)} />
            </>
          ) : null}

          {step === 2 && !editing ? (
            <>
              <Text style={styles.title}>How do you want to start?</Text>
              <Text style={styles.body}>Pick one path. You can create a project, join a team, or look around with no project at all.</Text>
              <SelectCard title="Create a project" detail="Set up a workspace and add tasks when you are ready. Teammates can join later." selected={path === 'start'} onPress={() => { setPath('start'); setError(''); }} />
              <SelectCard title="Join a team" detail="Use an invitation code from a project that already exists." selected={path === 'join'} onPress={() => { setPath('join'); setError(''); }} />
              <SelectCard title="Explore first" detail="Open Syncro now. Nothing is created until you choose to." selected={path === 'explore'} onPress={() => { setPath('explore'); setError(''); }} />
              <View style={styles.explain}>
                <Text style={styles.featureTitle}>Goal, tasks, milestones</Text>
                <Text style={styles.note}>A goal is the outcome. Tasks are the work. Milestones are optional checkpoints you add inside a project, not during setup.</Text>
              </View>
              {path === 'join' ? (
                <Field label="Invitation code" value={code} onChangeText={setCode} placeholder="Paste the code" autoCapitalize="none" />
              ) : null}
              {error ? <ErrorText>{error}</ErrorText> : null}
              {path === 'start' ? <Button title="Create a project" onPress={() => void openApp('start')} busy={busy} /> : null}
              {path === 'join' ? <Button title="Join project" onPress={() => void joinTeam()} busy={busy} /> : null}
              {path === 'explore' ? <Button title="Open Syncro" onPress={() => void openApp('explore')} busy={busy} /> : null}
              {path === 'join' ? <Button title="Explore instead" onPress={() => void openApp('explore')} secondary /> : null}
              <TextButton title="Back" onPress={() => goTo(1)} />
            </>
          ) : null}

          {editing ? (
            <>
              <Text style={styles.title}>Your goals</Text>
              <Text style={styles.body}>These stay on your profile. They suggest how the built-in planner thinks about the work. They do not create a project.</Text>
              <View style={styles.choices}>
                {GOAL_PRESETS.map((goal) => (
                  <Chip key={goal.id} label={goal.label} active={goals.includes(goal.id)} onPress={() => toggleGoal(goal.id)} />
                ))}
              </View>
              {goals.length >= 8 ? <Text style={styles.note}>You can save up to 8 goals.</Text> : null}
              <Text style={styles.note}>{goalSummary(goals, customGoal) || 'No goal selected.'}</Text>
              <Field label="Something else" value={customGoal} onChangeText={setCustomGoal} placeholder="Optional" maxLength={200} />
              <Text style={styles.section}>Planning pace</Text>
              <View style={styles.choices}>
                {PLANNING_STYLES.map((item) => (
                  <Chip key={item.id} label={item.label} active={style === item.id} onPress={() => setStyle(item.id)} />
                ))}
              </View>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button title="Save goals" busy={busy} onPress={() => void (async () => {
                setBusy(true);
                setError('');
                const message = await saveProfile(false);
                setBusy(false);
                if (message) {
                  setError(message);
                  return;
                }
                await refreshProfile();
                router.back();
              })()} />
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return {
    scroll: { paddingBottom: 36 },
    progress: { flexDirection: 'row' as const, gap: 6, marginBottom: 10 },
    bar: { flex: 1, height: 4, borderRadius: 4, backgroundColor: colors.line },
    barOn: { backgroundColor: colors.primary },
    step: { color: colors.faint, fontSize: 12, fontWeight: '700' as const, marginBottom: 12 },
    hero: { backgroundColor: colors.forestFill, borderRadius: 18, padding: 16, marginBottom: 14 },
    kicker: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4 },
    heroTitle: { color: colors.onForest, fontSize: 28, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.4, marginTop: 6 },
    heroBody: { color: colors.onForestMuted, fontSize: 15, lineHeight: 21, marginTop: 8 },
    title: { color: colors.ink, fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4, marginBottom: 8 },
    body: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 14 },
    section: { color: colors.ink, fontSize: 16, fontWeight: '700' as const, marginTop: 8, marginBottom: 6 },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 8 },
    note: { color: colors.muted, lineHeight: 20, marginBottom: 8 },
    exampleLabel: { color: colors.faint, fontSize: 12, fontWeight: '700' as const, marginBottom: 8 },
    preview: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginBottom: 14 },
    previewTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' as const },
    previewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 10 },
    previewDone: { color: colors.faint, textDecorationLine: 'line-through' as const, flex: 1 },
    previewTask: { color: colors.ink, flex: 1 },
    previewWhen: { color: colors.muted, fontSize: 12 },
    featureGrid: { gap: 12, marginBottom: 8 },
    feature: { flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const },
    featureTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' as const, marginBottom: 2 },
    explain: { marginTop: 4, marginBottom: 8 },
  } as const;
}
