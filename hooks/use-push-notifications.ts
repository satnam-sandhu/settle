/**
 * Registers push listeners and syncs Expo push token when the user is signed in.
 */

import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useUser } from '@/hooks/use-user';
import {
  getDeepLinkFromNotification,
  isPushNotificationsEnabled,
  registerForPushNotificationsAsync,
  unregisterForPushNotificationsAsync,
} from '@/lib/notifications';

function navigateFromNotificationData(
  router: ReturnType<typeof useRouter>,
  data: Record<string, unknown> | undefined
): void {
  const link = getDeepLinkFromNotification(data);
  if (!link?.route) return;

  router.push({
    pathname: link.route as never,
    params: link.params as never,
  });
}

export function usePushNotifications(): void {
  const router = useRouter();
  const { user } = useAuth();
  const { user: profile } = useUser();
  const lastSyncKey = useRef<string | null>(null);

  useEffect(() => {
    if (!isPushNotificationsEnabled()) return;

    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Foreground delivery — Realtime already refreshes data; no action required yet.
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(router, data);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(router, data);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!isPushNotificationsEnabled()) return;

    if (!user?.id) {
      lastSyncKey.current = null;
      return;
    }

    if (!profile) return;

    const optedIn = profile.notifications_enabled !== false;
    const syncKey = `${user.id}:${optedIn ? 'on' : 'off'}`;
    if (lastSyncKey.current === syncKey) return;
    lastSyncKey.current = syncKey;

    if (!optedIn) {
      unregisterForPushNotificationsAsync().catch((error) => {
        console.error('[Notifications] Unregister failed:', error);
        lastSyncKey.current = null;
      });
      return;
    }

    registerForPushNotificationsAsync().catch((error) => {
      console.error('[Notifications] Registration failed:', error);
      lastSyncKey.current = null;
    });
  }, [user?.id, profile, profile?.notifications_enabled]);
}
