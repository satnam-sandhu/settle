/**
 * Network Status Hook (web)
 *
 * Probes Supabase instead of google.com/generate_204 (CORS-blocked in browsers).
 * Treats any non-5xx as reachable — a missing API key still returns 401.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function probeUrl(): string {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  if (supabaseUrl) {
    return `${supabaseUrl}/auth/v1/health`;
  }
  return '/manifest.json';
}

async function checkOnline(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  try {
    const probe = probeUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const headers: Record<string, string> = {};
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
    if (anonKey && probe.includes('supabase.co')) {
      headers.apikey = anonKey;
      headers.Authorization = `Bearer ${anonKey}`;
    }

    const response = await fetch(probe, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

export interface NetworkStatus {
  isOnline: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  refresh: () => Promise<void>;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    try {
      const online = await checkOnline();
      setIsOnline(online);
      setLastChecked(new Date());
    } catch {
      setIsOnline(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        refresh();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const goOnline = () => {
      void refresh();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [refresh]);

  useEffect(() => {
    const intervalMs = isOnline ? 10000 : 5000;
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [isOnline, refresh]);

  return {
    isOnline,
    isChecking,
    lastChecked,
    refresh,
  };
}
