/**
 * PostHog Analytics Utility
 * 
 * Wrapper around PostHog React Native SDK for easy event tracking.
 * Uses PostHogProvider pattern - wrap your app with PostHogProvider,
 * then use these utility functions for tracking.
 */

import Constants from 'expo-constants';
import PostHog, { PostHogProvider, usePostHog } from 'posthog-react-native';
import { Platform } from 'react-native';

// Re-export PostHogProvider and usePostHog for use in _layout.tsx
export { PostHogProvider, usePostHog };

// Environment variables - exported for PostHogProvider configuration
export const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
export const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

/**
 * Analytics is on when EXPO_PUBLIC_ANALYTICS_ENABLED is not "false" and a PostHog key exists.
 * Set EXPO_PUBLIC_ANALYTICS_ENABLED=false in .env during local development.
 */
export function isAnalyticsEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  if (flag === 'false' || flag === '0') return false;
  return Boolean(posthogApiKey);
}

// PostHog client instance (set via setPostHogClient from a component using usePostHog)
let posthogClient: PostHog | null = null;

/**
 * Set the PostHog client instance
 * Call this from a component that has access to usePostHog hook
 */
export function setPostHogClient(client: PostHog | null): void {
  if (!isAnalyticsEnabled()) {
    posthogClient = null;
    return;
  }
  posthogClient = client;
  if (client && __DEV__) {
    console.log('[Analytics] PostHog client initialized');
  }
}

/**
 * Track an event with optional properties
 */
export function track(eventName: string, properties?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  // Enrich with common properties
  const enrichedProperties = {
    ...properties,
    app_version: Constants.expoConfig?.version,
    platform: Platform.OS,
    timestamp: new Date().toISOString(),
  };

  posthogClient.capture(eventName, enrichedProperties);

  if (__DEV__) {
    console.log('[Analytics] Track:', eventName, enrichedProperties);
  }
}

/**
 * Identify a user after sign-in
 * Links all future events to this user ID
 */
export function identify(
  userId: string,
  properties?: {
    phone?: string;
    name?: string;
    email?: string;
    created_at?: string;
    [key: string]: unknown;
  }
): void {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  posthogClient.identify(userId, properties);

  if (__DEV__) {
    console.log('[Analytics] Identify:', userId, properties);
  }
}

/**
 * Set or update user properties without changing identity
 */
export function setUserProperties(properties: Record<string, unknown>): void {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  posthogClient.capture('$set', {
    $set: properties,
  });

  if (__DEV__) {
    console.log('[Analytics] Set user properties:', properties);
  }
}

/**
 * Set user properties only if they haven't been set before
 * Useful for properties like first_seen_at, signup_source, etc.
 */
export function setUserPropertiesOnce(properties: Record<string, unknown>): void {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  posthogClient.capture('$set', {
    $set_once: properties,
  });

  if (__DEV__) {
    console.log('[Analytics] Set user properties once:', properties);
  }
}

/**
 * Reset user identity on sign-out
 * Unlinks future events from the current user
 */
export function reset(): void {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  posthogClient.reset();

  if (__DEV__) {
    console.log('[Analytics] Reset - user identity cleared');
  }
}

/**
 * Track a screen view event
 * Convenience wrapper for screen navigation tracking
 */
export function trackScreen(screenName: string, properties?: Record<string, unknown>): void {
  track('screen_viewed', {
    screen_name: screenName,
    ...properties,
  });
}

/**
 * Check if a feature flag is enabled for the current user
 */
export async function isFeatureEnabled(flagKey: string): Promise<boolean> {
  if (!isAnalyticsEnabled() || !posthogClient) return false;

  try {
    const enabled = await posthogClient.isFeatureEnabled(flagKey);
    return enabled ?? false;
  } catch {
    return false;
  }
}

/**
 * Get the payload of a feature flag
 */
export async function getFeatureFlagPayload(flagKey: string): Promise<unknown> {
  if (!isAnalyticsEnabled() || !posthogClient) return null;

  try {
    return await posthogClient.getFeatureFlagPayload(flagKey);
  } catch {
    return null;
  }
}

/**
 * Reload feature flags from PostHog
 * Call after user identification or when flags might have changed
 */
export async function reloadFeatureFlags(): Promise<void> {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  try {
    await posthogClient.reloadFeatureFlagsAsync();
    if (__DEV__) {
      console.log('[Analytics] Feature flags reloaded');
    }
  } catch (error) {
    console.error('[Analytics] Failed to reload feature flags:', error);
  }
}

/**
 * Manually flush pending events to PostHog
 * Useful before app backgrounding or on critical events
 */
export async function flush(): Promise<void> {
  if (!isAnalyticsEnabled() || !posthogClient) return;

  try {
    await posthogClient.flush();
    if (__DEV__) {
      console.log('[Analytics] Events flushed');
    }
  } catch (error) {
    console.error('[Analytics] Failed to flush events:', error);
  }
}

/**
 * Get the raw PostHog client instance
 * Use sparingly - prefer the utility functions above
 */
export function getPostHogClient(): PostHog | null {
  return posthogClient;
}

// Convenience export for all analytics functions
export const Analytics = {
  setClient: setPostHogClient,
  track,
  identify,
  setUserProperties,
  setUserPropertiesOnce,
  reset,
  trackScreen,
  isFeatureEnabled,
  getFeatureFlagPayload,
  reloadFeatureFlags,
  flush,
  getClient: getPostHogClient,
};

export default Analytics;
