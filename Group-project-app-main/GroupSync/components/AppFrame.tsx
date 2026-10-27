import { Platform, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/features/theme/ThemeProvider';

const PHONE_WIDTH = 430;

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const framed = Platform.OS === 'web' && width > PHONE_WIDTH;

  if (!framed) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.mutedSurface,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          flex: 1,
          width: PHONE_WIDTH,
          maxWidth: '100%',
          backgroundColor: colors.background,
          overflow: 'hidden',
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: colors.border,
        }}
      >
        {children}
      </View>
    </View>
  );
}
