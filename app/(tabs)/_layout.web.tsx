import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import { useSegments } from 'expo-router';
import { AnimatePresence } from 'moti';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { OfflineBanner } from '@/components/ui/offline-banner';
import { brand, platform } from '@/constants/colors';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Analytics } from '@/lib/analytics';
import { ADD_SHEET_EVENTS, NAV_EVENTS } from '@/lib/analytics-events';

const TAB_ANALYTICS: Record<string, string> = {
  index: NAV_EVENTS.TAB_HOME_VIEWED,
  friends: NAV_EVENTS.TAB_FRIENDS_VIEWED,
  groups: NAV_EVENTS.TAB_GROUPS_VIEWED,
};

function TabAnalyticsListener() {
  const segments = useSegments();
  const lastTab = useRef<string | null>(null);

  useEffect(() => {
    if (segments[0] !== '(tabs)') return;

    const tab = segments[1] ?? 'index';
    if (tab === lastTab.current) return;

    if (tab === 'add') {
      Analytics.track(NAV_EVENTS.TAB_ADD_TAPPED);
      Analytics.track(ADD_SHEET_EVENTS.ADD_SHEET_OPENED, { entry_point: 'tab_plus' });
    } else {
      const event = TAB_ANALYTICS[tab];
      if (event) Analytics.track(event);
    }

    lastTab.current = tab;
  }, [segments]);

  return null;
}

export default function WebTabLayout() {
  const { isOnline } = useSync();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const backgroundColor = isDark ? platform.background.dark : platform.background.light;
  const tabBarBackground = isDark ? platform.surface.dark : platform.white;
  const inactiveColor = isDark ? platform.gray[400] : platform.gray[500];

  return (
    <View style={[styles.root, { backgroundColor }]}>
      <TabAnalyticsListener />

      <AnimatePresence>
        {!isOnline && <OfflineBanner key="offline-banner" placement="top" />}
      </AnimatePresence>

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: brand.primary[500],
          tabBarInactiveTintColor: inactiveColor,
          tabBarStyle: {
            backgroundColor: tabBarBackground,
            borderTopColor: isDark ? platform.gray[800] : platform.gray[200],
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="home" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="friends"
          options={{
            title: 'Friends',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="people" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            title: 'Groups',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="layers" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: 'Search',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="search" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
});
