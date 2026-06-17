import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { SettingsProvider } from '@/contexts/settings-context';
import { SyncProvider } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import {
  isAnalyticsEnabled,
  posthogApiKey,
  posthogHost,
  PostHogProvider,
  setPostHogClient,
  usePostHog,
} from '@/lib/analytics';
import { queryClient } from '@/lib/query-client';

/**
 * Component that captures the PostHog client and makes it available
 * to the analytics utility functions outside of React components
 */
function AnalyticsSetup({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog();

  useEffect(() => {
    if (posthog) {
      setPostHogClient(posthog);
    }
  }, [posthog]);

  return <>{children}</>;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme() ?? 'light';
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  usePushNotifications();
  useRealtimeSync();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // Redirect to sign-in if not authenticated
      router.replace('/(auth)/sign-in');
    } else if (user && inAuthGroup) {
      // Redirect to home if authenticated
      router.replace('/(tabs)');
    }
  }, [user, isLoading, segments]);

  // Show loading screen while checking auth
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScheme === 'dark' ? colors.background.dark : colors.background.light }}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', headerShown: true }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SettingsProvider>
          <AuthProvider>
            <SyncProvider>{children}</SyncProvider>
          </AuthProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export default function RootLayout() {
  if (!isAnalyticsEnabled()) {
    return (
      <AppProviders>
        <RootLayoutNav />
      </AppProviders>
    );
  }

  return (
    <PostHogProvider
      apiKey={posthogApiKey}
      options={{
        host: posthogHost,
        debug: __DEV__,
      }}
    >
      <AnalyticsSetup>
        <AppProviders>
          <RootLayoutNav />
        </AppProviders>
      </AnalyticsSetup>
    </PostHogProvider>
  );
}
