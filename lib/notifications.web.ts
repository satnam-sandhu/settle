/**
 * Web stub — Expo push is native-only. Avoid importing expo-notifications on web
 * (it logs unsupported listeners and is unused).
 */

export function isPushNotificationsEnabled(): boolean {
  return false;
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  return null;
}

export async function unregisterForPushNotificationsAsync(): Promise<void> {}

export type NotificationDeepLink = {
  route?: string;
  params?: Record<string, string>;
};

export function getDeepLinkFromNotification(
  _data: Record<string, unknown> | undefined
): NotificationDeepLink | null {
  return null;
}
