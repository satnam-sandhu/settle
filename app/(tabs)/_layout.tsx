import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { AnimatePresence } from 'moti';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { OfflineBanner } from '@/components/ui/offline-banner';
import { brand } from '@/constants/colors';
import { useSync } from '@/contexts/sync-context';
import { usePlatformChrome } from '@/hooks/use-platform-chrome';
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

export default function TabLayout() {
  const { isOnline } = useSync();
  const {
    tabBarBackground,
    tabIconDefault,
    useExplicitNativeChrome,
    iosTabBarBlurEffect,
  } = usePlatformChrome();

  return (
    <View style={{ flex: 1 }}>
      <TabAnalyticsListener />

      <AnimatePresence>
        {!isOnline && <OfflineBanner key="offline-banner" placement="top" />}
      </AnimatePresence>

      {/*
        Add tab uses NativeTabs.Trigger role="search" + nested Stack with headerSearchBarOptions.
        https://docs.expo.dev/router/advanced/native-tabs/#separate-search-tab
      */}
      <NativeTabs
        minimizeBehavior="onScrollDown"
        disableTransparentOnScrollEdge
        tintColor={brand.primary[500]}
        rippleColor={Platform.OS === 'android' ? brand.primary[100] : undefined}
        backgroundColor={useExplicitNativeChrome ? tabBarBackground : undefined}
        iconColor={useExplicitNativeChrome ? tabIconDefault : undefined}
        labelStyle={useExplicitNativeChrome ? { color: tabIconDefault } : undefined}
        blurEffect={iosTabBarBlurEffect}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'house', selected: 'house.fill' }}
            src={
              <NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="home" />
            }
          />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="friends">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'person.2', selected: 'person.2.fill' }}
            src={
              <NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="people" />
            }
          />
          <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="groups">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'square.stack.3d.up', selected: 'square.stack.3d.up.fill' }}
            src={
              <NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="layers" />
            }
          />
          <NativeTabs.Trigger.Label>Groups</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="add"
          role={Platform.OS === 'ios' ? 'search' : undefined}
        >
          <NativeTabs.Trigger.Icon
            sf="magnifyingglass"
            src={
              <NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="search" />
            }
          />
          {Platform.OS === 'ios' || true ? (
            <NativeTabs.Trigger.Label hidden />
          ) : (
            <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
          )}
        </NativeTabs.Trigger>
      </NativeTabs>
    </View>
  );
}
