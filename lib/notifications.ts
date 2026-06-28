/**
 * Push notification utilities (Expo Notifications + Supabase token storage).
 * @see docs/PUSH_NOTIFICATIONS_PLAN.md
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getEasProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#4CAF50',
  });
}

/**
 * Request OS permission, obtain Expo push token, and upsert into user_push_tokens.
 * Returns null on simulator, permission denied, or on error.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    if (__DEV__) {
      console.log('[Notifications] Push tokens require a physical device or dev build');
    }
    return null;
  }

  await ensureAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    if (__DEV__) {
      console.log('[Notifications] Permission not granted');
    }
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    console.error('[Notifications] Missing EAS projectId in app config');
    return null;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const saved = await persistPushToken(token);
    if (__DEV__) {
      if (saved) {
        console.log('[Notifications] Expo push token registered');
      } else {
        console.warn('[Notifications] Got Expo token but failed to save to Supabase');
      }
    }
    return saved ? token : null;
  } catch (error) {
    console.error('[Notifications] Failed to get push token:', error);
    return null;
  }
}

async function persistPushToken(token: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;

  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_app_version: Constants.expoConfig?.version ?? null,
    p_device_name: Device.deviceName ?? null,
  });

  if (error) {
    console.error('[Notifications] Failed to persist push token:', error.message);
    return false;
  }

  return true;
}

export type NotificationDeepLink = {
  route?: string;
  params?: Record<string, string>;
};

export function getDeepLinkFromNotification(
  data: Record<string, unknown> | undefined
): NotificationDeepLink | null {
  if (!data?.route || typeof data.route !== 'string') return null;

  const params =
    data.params && typeof data.params === 'object' && !Array.isArray(data.params)
      ? (data.params as Record<string, string>)
      : undefined;

  return { route: data.route, params };
}
