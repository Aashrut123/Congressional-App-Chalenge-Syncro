
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { isDarkColor } from '@/lib/theme';

export const APPEARANCE_THEMES = {
  Light: {
    name: 'Light',
    background: '#F5F6F2',
    card: '#FFFFFF',
    text: '#192C25',
    muted: '#66736B',
    accent: '#26745A',
    accentText: '#FFFFFF',
    border: '#D5DED6',
  },
  Dark: {
    name: 'Dark',
    background: '#111A17',
    card: '#1B2822',
    text: '#F0F5F1',
    muted: '#A8B9AE',
    accent: '#3D9A78',
    accentText: '#062016',
    border: '#2C3D34',
  },
  Orange: {
    name: 'Orange',
    background: '#FAFAF7',
    card: '#F3EFEA',
    text: '#2B2625',
    muted: '#8C827A',
    accent: '#C85A32',
    accentText: '#FFFFFF',
    border: '#E6DFD5',
  },
  Ocean: {
    name: 'Ocean',
    background: '#0B132B',
    card: '#1C2541',
    text: '#FFFFFF',
    muted: '#6FFFE9',
    accent: '#00B4D8',
    accentText: '#0B132B',
    border: '#2B3A67',
  },
  Lavender: {
    name: 'Lavender',
    background: '#F8F7FC',
    card: '#FFFFFF',
    text: '#2D2342',
    muted: '#827B93',
    accent: '#7C3AED',
    accentText: '#FFFFFF',
    border: '#E9E3F5',
  },
} as const;

export type ThemeName = keyof typeof APPEARANCE_THEMES;

type Palette = {
  name: string;
  background: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  border: string;
};

type AppearanceContextValue = {
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
  palette: Palette;
  largeText: boolean;
  setLargeText: (value: boolean) => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
  reducedMotion: boolean;
  setReducedMotion: (value: boolean) => void;
};

const STORAGE_KEY = 'groupsync-appearance-v1';

const AppearanceContext =
  createContext<AppearanceContextValue | null>(null);

function isThemeName(value: unknown): value is ThemeName {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(APPEARANCE_THEMES, value)
  );
}

export function AppearanceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [themeName, setThemeName] = useState<ThemeName>('Light');
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load saved preferences once when the app starts.
  useEffect(() => {
    let active = true;

    async function loadPreferences() {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);

        if (!saved) return;

        const preferences: unknown = JSON.parse(saved);

        if (
          typeof preferences !== 'object' ||
          preferences === null
        ) {
          return;
        }

        const values = preferences as Record<string, unknown>;

        if (isThemeName(values.themeName)) {
          setThemeName(values.themeName);
        }

        if (typeof values.largeText === 'boolean') {
          setLargeText(values.largeText);
        }

        if (typeof values.highContrast === 'boolean') {
          setHighContrast(values.highContrast);
        }

        if (typeof values.reducedMotion === 'boolean') {
          setReducedMotion(values.reducedMotion);
        }
      } catch (error) {
        console.warn('Could not load appearance settings:', error);
      } finally {
        if (active) setLoaded(true);
      }
    }

    void loadPreferences();

    return () => {
      active = false;
    };
  }, []);

  // Save whenever a preference changes, after initial loading.
  useEffect(() => {
    if (!loaded) return;

    const preferences = {
      themeName,
      largeText,
      highContrast,
      reducedMotion,
    };

    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(preferences),
    ).catch((error) => {
      console.warn('Could not save appearance settings:', error);
    });
  }, [loaded, themeName, largeText, highContrast, reducedMotion]);

  const palette = useMemo(() => {
    const base = APPEARANCE_THEMES[themeName];

    if (!highContrast) return base;

    const dark = isDarkColor(base.background);

    return {
      ...base,
      text: dark ? '#FFFFFF' : '#000000',
      muted: dark ? '#F9FAFB' : '#222222',
      border: dark ? '#FFFFFF' : '#111111',
    };
  }, [themeName, highContrast]);

  const value = useMemo(
    () => ({
      themeName,
      setThemeName,
      palette,
      largeText,
      setLargeText,
      highContrast,
      setHighContrast,
      reducedMotion,
      setReducedMotion,
    }),
    [
      themeName,
      palette,
      largeText,
      highContrast,
      reducedMotion,
    ],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useOptionalAppearance() {
  return useContext(AppearanceContext);
}

export function useAppearance() {
  const context = useOptionalAppearance();

  if (!context) {
    throw new Error(
      'useAppearance must be used inside AppearanceProvider.',
    );
  }

  return context;
}
