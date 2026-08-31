import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { useSegments } from 'expo-router';
import { AnimatePresence } from 'moti';
import { forwardRef, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

type WebTabButtonProps = TabTriggerSlotProps & {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  inactiveColor: string;
};

const WebTabButton = forwardRef<View, WebTabButtonProps>(function WebTabButton(
  { icon, label, inactiveColor, isFocused = false, style: _style, ...pressableProps },
  ref
) {
  const color = isFocused ? brand.primary[500] : inactiveColor;

  return (
    <Pressable
      ref={ref}
      {...pressableProps}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
    >
      <MaterialIcons name={icon} size={24} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
});

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

      <Tabs style={styles.tabs}>
        <TabSlot />
        <TabList
          style={[
            styles.tabList,
            {
              backgroundColor: tabBarBackground,
              borderTopColor: isDark ? platform.gray[800] : platform.gray[200],
            },
          ]}
        >
          <TabTrigger name="index" href="/" asChild>
            <WebTabButton icon="home" label="Home" inactiveColor={inactiveColor} />
          </TabTrigger>
          <TabTrigger name="friends" href="/friends" asChild>
            <WebTabButton icon="people" label="Friends" inactiveColor={inactiveColor} />
          </TabTrigger>
          <TabTrigger name="groups" href="/groups" asChild>
            <WebTabButton icon="layers" label="Groups" inactiveColor={inactiveColor} />
          </TabTrigger>
          <TabTrigger name="add" href="/add" asChild>
            <WebTabButton icon="search" label="Search" inactiveColor={inactiveColor} />
          </TabTrigger>
        </TabList>
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
  tabs: {
    flex: 1,
  },
  tabList: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 52,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
