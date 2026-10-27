import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/features/theme/ThemeProvider';
import { usePhoneAlerts } from '@/hooks/usePhoneAlerts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { usePrefersReducedMotion } from '@/lib/motion';
<<<<<<< HEAD
import { radius } from '@/lib/theme';

function TabButton({ style, ...props }: PressableProps) {
  return <Pressable {...props} style={[style as StyleProp<ViewStyle>, { borderRadius: radius.md, overflow: 'hidden' }]} />;
}
=======
import { useAppearance } from '@/lib/AppearanceProvider';
>>>>>>> c260418 (tried fixing some themes)

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  tasks: 'checkmark-circle',
  groups: 'folder-open',
  calendar: 'calendar',
  profile: 'person-circle',
};

export default function TabLayout() {
  const { palette } = useAppearance();
  const { user, profile, loading } = useAuth();
  const { colors } = useTheme();
  const { tasks, events } = useWorkspace();
  const insets = useSafeAreaInsets();
  const reduceMotion = usePrefersReducedMotion();
<<<<<<< HEAD
=======
  const desktop = width >= 960;

>>>>>>> c260418 (tried fixing some themes)
  usePhoneAlerts(Boolean(user), tasks, events);

  if (loading) return <Loading />;
  if (!user) return <Redirect href="/auth" />;
  if (profile?.onboarding_completed === false) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        animation: reduceMotion ? 'none' : 'fade',
<<<<<<< HEAD
        transitionSpec: reduceMotion ? undefined : { animation: 'timing', config: { duration: 200 } },
        tabBarPosition: 'bottom',
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarStyle: {
          height: 58 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
          borderTopColor: colors.border,
          borderTopWidth: 1,
          backgroundColor: colors.surface,
        },
        tabBarItemStyle: { borderRadius: radius.md, marginHorizontal: 2 },
        tabBarButton: (props) => <TabButton {...props} />,
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11, marginTop: 2 },
        tabBarIcon: ({ color, focused }) => (
          <Ionicons
            name={focused ? icons[route.name] : `${icons[route.name]}-outline` as keyof typeof Ionicons.glyphMap}
            size={22}
=======
        transitionSpec: reduceMotion
          ? undefined
          : { animation: 'timing', config: { duration: 200 } },

        // Match the screen background, including the area behind the tabs.
        sceneStyle: {
          backgroundColor: palette.background,
        },

        tabBarPosition: desktop ? 'left' : 'bottom',
        tabBarLabelPosition: desktop ? 'beside-icon' : 'below-icon',

        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarActiveBackgroundColor: desktop
          ? palette.background
          : 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',

        tabBarStyle: desktop
          ? {
              width: 232,
              backgroundColor: palette.background,
              borderRightColor: palette.border,
              paddingTop: 18,
              paddingHorizontal: 12,
            }
          : {
              height: 84,
              paddingTop: 9,
              paddingBottom: 18,
              backgroundColor: palette.background,
              borderTopColor: palette.border,
            },

        tabBarItemStyle: desktop
          ? {
              borderRadius: 12,
              marginVertical: 2,
              paddingHorizontal: 10,
              justifyContent: 'flex-start',
            }
          : undefined,

        tabBarLabelStyle: {
          fontWeight: '700',
          fontSize: desktop ? 14 : 10,
        },

        tabBarIcon: ({ color, focused, size }) => (
          <Ionicons
            name={
              focused
                ? icons[route.name]
                : `${icons[route.name]}-outline` as keyof typeof Ionicons.glyphMap
            }
            size={desktop ? 22 : size}
>>>>>>> c260418 (tried fixing some themes)
            color={color}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="tasks" options={{ title: 'My Tasks' }} />
      <Tabs.Screen name="groups" options={{ title: 'Projects' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}