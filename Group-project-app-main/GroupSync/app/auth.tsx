import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Redirect, router } from 'expo-router';
import * as Linking from 'expo-linking';

import {
  Button,
  Chip,
  ErrorText,
  Field,
  Page,
  TextButton,
  Title,
} from '@/components/ui';

import { useAuth } from '@/features/auth/AuthProvider';
import {
  isSupabaseConfigured,
  supabase,
} from '@/lib/supabase';

import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

export default function AuthScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    setError('');

    if (!isSupabaseConfigured) {
      setError(
        'Connect your Supabase URL and publishable key in .env before signing in.'
      );
      return;
    }

    if (!email.trim() || password.length < 6) {
      setError(
        'Enter a valid email and a password with at least 6 characters.'
      );
      return;
    }

    setBusy(true);

    const result =
      mode === 'signup'
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                display_name: name.trim(),
              },
            },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

    setBusy(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === 'signup' && !result.data.session) {
      Alert.alert(
        'Check your email',
        'Confirm your email address, then come back to sign in.'
      );
    } else {
      router.replace('/(tabs)');
    }
  };

  const resetPassword = async () => {
    setError('');

    if (!email.trim()) {
      setError(
        'Enter your email first, then tap reset password.'
      );
      return;
    }

    const { error: resetError } =
      await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: Linking.createURL('callback'),
        }
      );

    if (resetError) {
      setError(resetError.message);
    } else {
      Alert.alert(
        'Reset email sent',
        'Check your inbox for a password reset link.'
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
    <KeyboardAvoidingView
      style={styles.safe}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Page style={styles.page}>
          <View style={styles.brand}>
            <View style={styles.mark}>
              <Text style={styles.markText}>G</Text>
            </View>

            <Text style={styles.brandName}>Syncro</Text>
          </View>

          <Title subtitle="Bring deadlines, meetings, and teammates together in one calm workspace.">
            Your group work, in sync.
          </Title>

          <View style={styles.switcher}>
            <Chip label="Log in" active={mode === 'login'} onPress={() => setMode('login')} />
            <Chip label="Create account" active={mode === 'signup'} onPress={() => setMode('signup')} />
          </View>

          {mode === 'signup' && (
            <Field
              label="Display name"
              placeholder="How teammates know you"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          )}

          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Field
            label="Password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error ? <ErrorText>{error}</ErrorText> : null}

          <Button
            title={
              busy
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Create account'
            }
            onPress={() => void submit()}
            disabled={busy}
          />

          {mode === 'login' ? (
            <View style={styles.resetWrap}>
              <TextButton title="Forgot password?" onPress={() => void resetPassword()} />
            </View>
          ) : null}

          <Text style={styles.foot}>
            Secure group spaces powered by Supabase.
          </Text>
        </Page>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return {
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
  },

  page: {
    paddingTop: 18,
    paddingBottom: 24,
  },

  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 30,
  },

  mark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  markText: {
    color: colors.onPrimary,
    fontSize: 20,
    fontWeight: '900',
  },

  brandName: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
  },

  switcher: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },

  resetWrap: {
    alignItems: 'center',
  },

  foot: {
    color: colors.faint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 28,
  },
} as const;
}
