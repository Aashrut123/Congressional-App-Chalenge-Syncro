import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useOptionalAppearance } from '@/lib/AppearanceProvider';
import { colorsForAppearance, darkColors, isDarkColor, lightColors, radius, space, type, type AppColors } from '@/lib/theme';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

type ThemeValue = {
  colors: AppColors;
  scheme: 'light' | 'dark';
  preference: ColorSchemePreference;
  setPreference: (value: ColorSchemePreference) => void;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
};

const STORAGE_KEY = 'groupsync-appearance';

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ColorSchemePreference>('system');

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!alive) return;
      if (stored === 'light' || stored === 'dark' || stored === 'system') setPreferenceState(stored);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = (value: ColorSchemePreference) => {
    setPreferenceState(value);
    void AsyncStorage.setItem(STORAGE_KEY, value);
  };

  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const colors = scheme === 'dark' ? darkColors : lightColors;

  const value = useMemo<ThemeValue>(
    () => ({ colors, scheme, preference, setPreference, space, radius, type }),
    [colors, scheme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const appearance = useOptionalAppearance();
  const value = useContext(ThemeContext);
  const base = value ?? {
    colors: lightColors,
    scheme: 'light' as const,
    preference: 'system' as const,
    setPreference: () => undefined,
    space,
    radius,
    type,
  };
  if (!appearance) return base;
  return {
    ...base,
    colors: colorsForAppearance(appearance.themeName, appearance.palette),
    scheme: isDarkColor(appearance.palette.background) ? 'dark' : 'light',
  };
}
