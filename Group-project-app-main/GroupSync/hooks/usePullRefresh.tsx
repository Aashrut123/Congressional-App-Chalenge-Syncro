import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';

import { useTheme } from '@/features/theme/ThemeProvider';

const MIN_VISIBLE_MS = 500;

export function usePullRefresh(reload: () => Promise<unknown>) {
  const { colors } = useTheme();
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);

  const onRefresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setRefreshing(true);
    const started = Date.now();
    try {
      await reloadRef.current();
    } catch {
      // The screen already shows its own load error.
    } finally {
      const remaining = MIN_VISIBLE_MS - (Date.now() - started);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      setRefreshing(false);
      running.current = false;
    }
  }, []);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => {
        void onRefresh();
      }}
      tintColor={colors.primary}
      colors={[colors.primary]}
      progressBackgroundColor={colors.surface}
    />
  );

  return { refreshing, onRefresh, refreshControl };
}
