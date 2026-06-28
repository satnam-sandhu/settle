/**
 * Registers push listeners and syncs Expo push token when the user is signed in.
 */

import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/auth-context';
import {
  getDeepLinkFromNotification,
  registerForPushNotificationsAsync,
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
  const lastRegisteredUserId = useRef<string | null>(null);

  useEffect(() => {
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
    if (!user?.id) {
      lastRegisteredUserId.current = null;
      return;
    }

    if (lastRegisteredUserId.current === user.id) return;
    lastRegisteredUserId.current = user.id;

    registerForPushNotificationsAsync().catch((error) => {
      console.error('[Notifications] Registration failed:', error);
      lastRegisteredUserId.current = null;
    });
  }, [user?.id]);
}
