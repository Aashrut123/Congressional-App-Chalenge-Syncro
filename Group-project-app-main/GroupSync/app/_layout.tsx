import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View, Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppFrame } from '@/components/AppFrame';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider, useTheme } from '@/features/theme/ThemeProvider';
import { theme } from '@/lib/theme';
import { AppearanceProvider } from '@/lib/AppearanceProvider';

export function ErrorBoundary({
  error,
  retry,
}: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        backgroundColor: theme.colors.background,
      }}
    >
      <Text
        style={{
          color: '#F4F7FC',
          fontSize: 22,
          fontWeight: '800',
        }}
      >
        Something broke on this screen
      </Text>

      <Text
        style={{
          color: '#B8C3D4',
          marginTop: 8,
          marginBottom: 12,
        }}
      >
        {error.message}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 16,
          paddingVertical: 14,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 48,
        }}
      >
        <Text
          style={{
            color: theme.colors.onPrimary,
            fontWeight: '700',
            fontSize: 15,
          }}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

function RootNavigator() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            color: colors.text,
            fontWeight: '800',
          },
          headerShadowVisible: false,
          animation: 'fade',
          animationDuration: 220,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="onboarding"
            options={{ headerShown: false }}
          />

          <Stack.Screen
            name="auth"
            options={{ presentation: 'modal' }}
          />

          <Stack.Screen
            name="create-group"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'New project',
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

          <Stack.Screen
            name="event/[id]"
            options={{
              headerShown: true,
              title: 'Calendar item',
            }}
          />

          <Stack.Screen
            name="task/[id]"
            options={{
              headerShown: true,
              title: 'Task',
            }}
          />

          <Stack.Screen
            name="plan"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'Plan project',
            }}
          />

          <Stack.Screen
            name="assistant"
            options={{
              headerShown: true,
              title: 'Assistant',
            }}
          />

          <Stack.Screen
            name="availability"
            options={{
              headerShown: true,
              title: 'Availability',
            }}
          />

          <Stack.Screen
            name="profile"
            options={{
              headerShown: true,
              title: 'Profile',
            }}
          />

          <Stack.Screen
            name="member/[userId]"
            options={{
              headerShown: true,
              title: 'Availability',
            }}
          />

          <Stack.Screen
            name="progress"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'Progress log',
            }}
          />

          <Stack.Screen
            name="notifications"
            options={{
              headerShown: true,
              title: 'Notices',
            }}
          />

          <Stack.Screen
            name="reschedule"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'Reschedule',
            }}
          />
        </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppearanceProvider>
            <AppFrame>
              <RootNavigator />
            </AppFrame>
          </AppearanceProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}