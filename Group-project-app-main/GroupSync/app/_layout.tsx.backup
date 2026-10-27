import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider, useTheme } from '@/features/theme/ThemeProvider';
import { AppearanceProvider } from '@/lib/AppearanceProvider';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.background }}>
      <Text style={{ color: theme.colors.ink, fontSize: 22, fontWeight: '800' }}>Something broke on this screen</Text>
      <Text style={{ color: theme.colors.muted, marginTop: 8, marginBottom: 12 }}>{error.message}</Text>
      <Button title="Try again" onPress={retry} />
    </View>
  );
}

function RootNavigator() {
  const { colors, scheme } = useTheme();
  return (
    <AuthProvider>
      <AppearanceProvider>
        <StatusBar style="dark" />

        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.primary,
            headerTitleStyle: { color: theme.colors.ink, fontWeight: '800' },
            headerShadowVisible: false,
            animation: 'fade',
            animationDuration: 220,
            contentStyle: {
              backgroundColor: theme.colors.background,
            },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />

          <Stack.Screen
            name="auth"
            options={{
              presentation: 'modal',
            }}
          />

          <Stack.Screen
            name="create-group"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'New group',
            }}
          />

          <Stack.Screen
            name="create-event"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'New calendar item',
            }}
          />

          <Stack.Screen
            name="create-task"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'New task',
            }}
          />

          <Stack.Screen
            name="group/[id]"
            options={{
              headerShown: true,
              title: 'Project',
            }}
          />
          <Stack.Screen name="event/[id]" options={{ headerShown: true, title: 'Calendar item' }} />
          <Stack.Screen name="task/[id]" options={{ headerShown: true, title: 'Task' }} />
          <Stack.Screen name="plan" options={{ presentation: 'modal', headerShown: true, title: 'Plan project' }} />
          <Stack.Screen name="availability" options={{ headerShown: true, title: 'Availability' }} />
          <Stack.Screen name="progress" options={{ presentation: 'modal', headerShown: true, title: 'Progress log' }} />
          <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notices' }} />
          <Stack.Screen name="reschedule" options={{ presentation: 'modal', headerShown: true, title: 'Reschedule' }} />
        </Stack>
      </AppearanceProvider>
    </ThemeProvider>
  );
}
