export type AppColors = {
  background: string;
  surface: string;
  elevated: string;
  mutedSurface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  primary: string;
  primaryPressed: string;
  primaryForeground: string;
  accent: string;
  onAccent: string;
  mint: string;
  onMint: string;
  forest: string;
  forestFill: string;
  onForest: string;
  onForestMuted: string;
  success: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  disabled: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  primaryDark: string;
  onPrimary: string;
  onPrimaryMuted: string;
  gold: string;
  red: string;
  blue: string;
};

export const lightColors: AppColors = {
  background: '#F5F6F2',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  mutedSurface: '#E7EEE8',
  text: '#192C25',
  textSecondary: '#66736B',
  textTertiary: '#8A978E',
  border: '#D5DED6',
  primary: '#26745A',
  primaryPressed: '#1C5C47',
  primaryForeground: '#FFFFFF',
  accent: '#B8E5C8',
  onAccent: '#163D32',
  mint: '#E7F6ED',
  onMint: '#163D32',
  forest: '#163D32',
  forestFill: '#163D32',
  onForest: '#F4FBF7',
  onForestMuted: '#C9DDD2',
  success: '#26745A',
  warning: '#8A5A12',
  warningBg: '#F8EFD9',
  danger: '#9F2C24',
  dangerBg: '#FDECEC',
  info: '#2F5E96',
  infoBg: '#E7F0FA',
  disabled: '#C5D0C8',
  ink: '#192C25',
  muted: '#66736B',
  faint: '#8A978E',
  line: '#D5DED6',
  primaryDark: '#163D32',
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#D7EBE3',
  gold: '#C59130',
  red: '#9F2C24',
  blue: '#2F5E96',
};

export const darkColors: AppColors = {
  background: '#111A17',
  surface: '#1B2822',
  elevated: '#22312A',
  mutedSurface: '#16241E',
  text: '#F0F5F1',
  textSecondary: '#A8B9AE',
  textTertiary: '#7E9186',
  border: '#2C3D34',
  primary: '#3D9A78',
  primaryPressed: '#2E7A5E',
  primaryForeground: '#062016',
  accent: '#B8E5C8',
  onAccent: '#10241C',
  mint: '#1C3328',
  onMint: '#E7F6ED',
  forest: '#E7F6ED',
  forestFill: '#1A332C',
  onForest: '#F4FBF7',
  onForestMuted: '#C9DDD2',
  success: '#7DCEA8',
  warning: '#E3C07A',
  warningBg: '#3A2E18',
  danger: '#F0A8A2',
  dangerBg: '#3A2220',
  info: '#9BB8E0',
  infoBg: '#1C2A38',
  disabled: '#3A4A42',
  ink: '#F0F5F1',
  muted: '#A8B9AE',
  faint: '#7E9186',
  line: '#2C3D34',
  primaryDark: '#E7F6ED',
  onPrimary: '#062016',
  onPrimaryMuted: '#B7D9C8',
  gold: '#E3C07A',
  red: '#F0A8A2',
  blue: '#9BB8E0',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 12, md: 18, lg: 24, pill: 999 };
export const type = { display: 32, title: 28, section: 18, body: 15, caption: 12 };

export const theme = {
  colors: lightColors,
  space,
  radius,
  type,
};

type AppearancePalette = {
  background: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  border: string;
};

export function isDarkColor(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 < 150;
}

/** Light and Dark use the original green palettes. The other themes use the palette as chosen. */
export function colorsForAppearance(themeName: string, palette: AppearancePalette): AppColors {
  if (themeName === 'Light') return lightColors;
  if (themeName === 'Dark') return darkColors;
  return colorsFromPalette(palette);
}

/** Map the chosen appearance palette onto the colors the screens already use. */
export function colorsFromPalette(palette: AppearancePalette): AppColors {
  const dark = isDarkColor(palette.background);
  const base = dark ? darkColors : lightColors;
  return {
    ...base,
    background: palette.background,
    surface: palette.card,
    elevated: palette.card,
    mutedSurface: dark ? palette.background : palette.border,
    text: palette.text,
    textSecondary: palette.muted,
    textTertiary: palette.muted,
    border: palette.border,
    primary: palette.accent,
    primaryPressed: palette.accent,
    primaryForeground: palette.accentText,
    accent: palette.accent,
    onAccent: palette.accentText,
    mint: palette.card,
    onMint: palette.text,
    forest: palette.text,
    forestFill: palette.card,
    onForest: palette.text,
    onForestMuted: palette.muted,
    success: palette.accent,
    disabled: palette.border,
    ink: palette.text,
    muted: palette.muted,
    faint: palette.muted,
    line: palette.border,
    primaryDark: palette.text,
    onPrimary: palette.accentText,
    onPrimaryMuted: palette.muted,
  };
}
