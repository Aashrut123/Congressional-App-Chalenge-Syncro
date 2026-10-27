import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { isExpoGo } from '@/lib/expoGo';
import { syncPhoneAlerts } from '@/lib/phoneAlerts';
import type { CalendarEvent, Task } from '@/types/database';

export function usePhoneAlerts(signedIn: boolean, tasks: Task[], events: CalendarEvent[]) {
  useEffect(() => {
    syncPhoneAlerts(tasks, events, signedIn);
  }, [signedIn, tasks, events]);

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo()) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const href = response.notification.request.content.data?.href;
      if (typeof href !== 'string') return;
      if (href.startsWith('/task/')) router.push(href as '/task/[id]');
      if (href.startsWith('/event/')) router.push(href as '/event/[id]');
    });
    return () => subscription.remove();
  }, []);
}
