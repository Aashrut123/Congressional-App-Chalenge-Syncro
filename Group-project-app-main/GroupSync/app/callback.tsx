import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';

import { router } from 'expo-router';
import { useURL } from 'expo-linking';

import {
  Button,
  ErrorText,
  Field,
  Loading,
  Page,
} from '@/components/ui';

import { supabase } from '@/lib/supabase';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { AppColors } from '@/lib/theme';

export default function AuthCallbackScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const url = useURL();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) return;

    const complete = async () => {
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');

        const hash = new URLSearchParams(
          parsed.hash.replace(/^#/, '')
        );

        const flowType =
          parsed.searchParams.get('type') || hash.get('type');

        const accessToken =
          parsed.searchParams.get('access_token') ||
          hash.get('access_token');

        const refreshToken =
          parsed.searchParams.get('refresh_token') ||
          hash.get('refresh_token');

        if (code) {
          const { error: issue } =
            await supabase.auth.exchangeCodeForSession(code);

          if (issue) throw issue;
        } else if (accessToken && refreshToken) {
          const { error: issue } =
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

          if (issue) throw issue;
        } else {
          throw new Error(
            'This sign-in link is incomplete or has expired. Request a new password reset email.'
          );
        }

        if (flowType && flowType !== 'recovery') {
          router.replace('/(tabs)');
          return;
        }

        setReady(true);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not verify this link.'
        );
      }
    };

    void complete();
  }, [url]);

  const updatePassword = async () => {
    if (password.length < 6) {
      setError(
        'Choose a password with at least 6 characters.'
      );
      return;
    }

    setBusy(true);
    setError('');

    const { error: issue } =
      await supabase.auth.updateUser({ password });

    setBusy(false);

    if (issue) {
      setError(issue.message);
    } else {
      Alert.alert(
        'Password updated',
        'You can now continue to your workspace.'
      );

      router.replace('/(tabs)');
    }
  };

  if (!ready && !error) return <Loading />;

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>
          Set a new password
        </Text>

        <Text style={styles.body}>
          Choose a new password for your Syncro account.
        </Text>

        {ready ? (
          <Field
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="At least 6 characters"
          />
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        {ready ? (
          <Button
            title={busy ? 'Updating…' : 'Update password'}
            onPress={() => void updatePassword()}
            disabled={busy}
          />
        ) : (
          <Button
            title="Back to sign in"
            onPress={() => router.replace('/auth')}
            secondary
          />
        )}
      </ScrollView>
    </Page>
  );
}

function createStyles(colors: AppColors) {
  return {
  content: {
    paddingTop: 28,
  },

  title: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '800',
  },

  body: {
    color: colors.muted,
    marginTop: 7,
    marginBottom: 22,
    lineHeight: 20,
  },
} as const;
}
