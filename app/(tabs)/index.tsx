/**
 * Home Screen
 *
 * Glanceable money view with balance summary and recent activity.
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import BottomSheet from '@gorhom/bottom-sheet';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceSummaryCard } from '@/components/balance-summary-card';
import { SettlePickerSheet } from '@/components/settle-picker-sheet';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonActivityList } from '@/components/ui/skeleton';
import { colors } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFriends } from '@/hooks/use-friends';
import { useRecentActivity, type ActivityItem } from '@/hooks/use-recent-activity';
import { useTabBarOffset } from '@/hooks/use-tab-bar-offset';
import { useUser } from '@/hooks/use-user';
import { hapticLight } from '@/lib/haptics';
import { Analytics } from '@/lib/analytics';
import { HOME_EVENTS, NAV_EVENTS, SETTLEMENT_EVENTS } from '@/lib/analytics-events';
import { formatCurrency } from '@/lib/utils';
import type { Friend } from '@/types';

/** Registered by HomeScreen so HomeHeader can open the sheet without prop churn. */
const homeSettlePickerActions = {
  open: null as (() => void) | null,
};

function computeBalanceSummary(friends: Friend[]) {
  if (!friends || friends.length === 0) {
    return { totalOwed: 0, totalOwing: 0, netBalance: 0 };
  }
  let totalOwed = 0;
  let totalOwing = 0;
  friends.forEach(friend => {
    if (friend.total_balance > 0) totalOwed += friend.total_balance;
    else if (friend.total_balance < 0) totalOwing += Math.abs(friend.total_balance);
  });
  return { totalOwed, totalOwing, netBalance: totalOwed - totalOwing };
}

/**
 * HomeHeader — stable module-level component so FlashList never remounts it.
 *
 * Defined outside HomeScreen so its reference is constant across renders.
 * This prevents FlashList from unmounting/remounting the header when reactive
 * state (e.g. isLoadingFriends) changes inside HomeScreen, which would
 * otherwise cause all entry MotiView animations to replay.
 */
function HomeHeader() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { user: authUser } = useAuth();
  const { user } = useUser();
  const { friends, isLoading: isLoadingFriends } = useFriends();

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;

  const balanceSummary = useMemo(() => computeBalanceSummary(friends), [friends]);

  const userName = user?.name || authUser?.user_metadata?.name || 'User';

  const handleOpenProfile = useCallback(() => {
    hapticLight();
    Analytics.track(NAV_EVENTS.PROFILE_OPENED, { entry_point: 'home_avatar' });
    router.push('/profile');
  }, []);

  return (
    <>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', damping: 18, stiffness: 100 }}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <Text style={[styles.greeting, { color: secondaryTextColor }]}>
            Welcome back,
          </Text>
          <Text style={[styles.name, { color: textColor }]}>
            {userName} 👋
          </Text>
        </View>
        <Pressable
          onPress={handleOpenProfile}
          style={({ pressed }) => [
            styles.avatarButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Avatar user={{ name: userName, avatar_url: user?.avatar_url ?? null }} size={44} />
        </Pressable>
      </MotiView>

      {/* Balance Summary Card */}
      <BalanceSummaryCard
        netBalance={balanceSummary.netBalance}
        totalOwed={balanceSummary.totalOwed}
        totalOwing={balanceSummary.totalOwing}
        isLoading={isLoadingFriends}
        onSettleUp={() => homeSettlePickerActions.open?.()}
      />

      {/* Recent Activity title */}
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 300 }}
      >
        <Text style={[styles.sectionTitle, { color: textColor }]}>Recent Activity</Text>
      </MotiView>
    </>
  );
}

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { contentPaddingBottom } = useTabBarOffset();
  const settlePickerRef = useRef<BottomSheet>(null);
  const { user } = useUser();
  const { isOnline } = useSync();
  const { friends, isLoading: isLoadingFriends, refresh: refreshFriends } = useFriends();
  const { activities, isLoading: isLoadingActivity, refresh: refreshActivity } = useRecentActivity();
  const [refreshing, setRefreshing] = useState(false);

  const balanceSummary = useMemo(() => computeBalanceSummary(friends), [friends]);

  const listContentStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: contentPaddingBottom }],
    [contentPaddingBottom],
  );

  useEffect(() => {
    homeSettlePickerActions.open = () => {
      Analytics.track(SETTLEMENT_EVENTS.SETTLE_UP_SHEET_OPENED, {
        entry_point: 'home_summary_card',
      });
      settlePickerRef.current?.expand();
    };
    return () => {
      homeSettlePickerActions.open = null;
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshFriends(), refreshActivity()]);
    setRefreshing(false);
  }, [refreshFriends, refreshActivity]);

  // Refetch when screen comes into focus (e.g., after adding expense)
  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        refreshFriends();
        refreshActivity();
      }

      if (!isLoadingFriends) {
        Analytics.track(HOME_EVENTS.SUMMARY_CARD_VIEWED, {
          net_balance: balanceSummary.netBalance,
          has_outstanding: balanceSummary.totalOwed > 0 || balanceSummary.totalOwing > 0,
        });
      }
    }, [
      isOnline,
      refreshFriends,
      refreshActivity,
      isLoadingFriends,
      balanceSummary.netBalance,
      balanceSummary.totalOwed,
      balanceSummary.totalOwing,
    ])
  );

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;

  const handleActivityPress = (item: ActivityItem) => {
    if (item.type === 'expense') {
      hapticLight();
      router.push(`/expense/${item.id}`);
      return;
    }
    if (item.type === 'expense_group') {
      hapticLight();
      router.push(`/expense/group/${item.id}`);
    }
    // Settlements don't have a detail screen yet
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const isLoading = isLoadingFriends || isLoadingActivity;
  const hasNoData = (!friends || friends.length === 0) && (!activities || activities.length === 0);

  // Show offline empty state when no cached data available
  if (!isOnline && !isLoading && hasNoData) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
        <View style={styles.offlineEmptyState}>
          <EmptyState
            icon="icloud.slash"
            title="No cached data"
            description="Connect to the internet to load your dashboard"
          />
        </View>
      </SafeAreaView>
    );
  }

  const renderActivityItem = useCallback(({ item, index }: { item: ActivityItem; index: number }) => {
    const isSettlement = item.type === 'settlement';
    const isYouPaid = item.paid_by.id === user?.id;
    const isGrouped = item.type === 'expense_group' && (item.line_count ?? 0) > 1;

    return (
      <MotiView
        from={{ opacity: 0, translateX: -20, scale: 0.95 }}
        animate={{ opacity: 1, translateX: 0, scale: 1 }}
        transition={{
          type: 'spring',
          damping: 18,
          stiffness: 120,
          delay: Math.min(index * 60, 300),
        }}
      >
        <Pressable
          onPress={() => handleActivityPress(item)}
          style={({ pressed }) => [
            styles.activityItem,
            {
              backgroundColor: cardBg,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {/* Icon */}
          <View
            style={[
              styles.activityIcon,
              {
                backgroundColor: isSettlement
                  ? colors.primary[100]
                  : colors.gray[100],
              },
            ]}
          >
            {item.category_icon ? (
              <Text style={styles.activityEmoji}>{item.category_icon}</Text>
            ) : (
              <IconSymbol
                name={isSettlement ? 'arrow.left.arrow.right' : 'doc.text'}
                size={18}
                color={isSettlement ? colors.success : colors.gray[600]}
              />
            )}
          </View>

          {/* Details */}
          <View style={styles.activityDetails}>
            <Text style={[styles.activityDescription, { color: textColor }]} numberOfLines={1}>
              {isSettlement
                ? (isYouPaid
                    ? `You paid ${item.paid_to?.name}`
                    : `${item.paid_by.name} paid you`)
                : item.description
              }
            </Text>
            <View style={styles.activityMeta}>
              <Text style={[styles.activityDate, { color: secondaryTextColor }]}>
                {formatDate(item.date)}
              </Text>
              {isGrouped && (
                <>
                  <Text style={[styles.activityDot, { color: secondaryTextColor }]}>•</Text>
                  <Text style={[styles.activityDate, { color: secondaryTextColor }]}>
                    {item.line_count} parts
                  </Text>
                </>
              )}
              {item.group_name && (
                <>
                  <Text style={[styles.activityDot, { color: secondaryTextColor }]}>•</Text>
                  <Text style={[styles.activityGroup, { color: secondaryTextColor }]} numberOfLines={1}>
                    {item.group_name}
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Amount */}
          <View style={styles.activityAmountContainer}>
            {isSettlement ? (
              <Text style={[styles.activityAmount, { color: colors.success }]}>
                {formatCurrency(item.amount, item.currency)}
              </Text>
            ) : (
              <>
                <Text style={[styles.activityAmount, { color: textColor }]}>
                  {formatCurrency(item.amount, item.currency)}
                </Text>
                {item.your_share !== undefined && item.your_share > 0 && (
                  <Text style={[styles.activityShare, { color: colors.error }]}>
                    you owe {formatCurrency(item.your_share, item.currency)}
                  </Text>
                )}
                {isYouPaid && (
                  <Text style={[styles.activityShare, { color: colors.success }]}>
                    you paid
                  </Text>
                )}
              </>
            )}
          </View>

          {/* Chevron for expenses */}
          {!isSettlement && (
            <IconSymbol name="chevron.right" size={16} color={secondaryTextColor} />
          )}
        </Pressable>
      </MotiView>
    );
  }, [user?.id, cardBg, textColor, secondaryTextColor, handleActivityPress, formatDate]);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
        <FlashList
          data={activities}
          renderItem={renderActivityItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={HomeHeader}
          ListEmptyComponent={
            isLoadingActivity ? (
              <SkeletonActivityList count={4} />
            ) : (
              <View style={[styles.emptyState, { backgroundColor: cardBg }]}>
                <EmptyState
                  icon="clock"
                  title="No recent activity"
                  description="Your expenses and settlements will appear here"
                  compact
                />
              </View>
            )
          }
          contentContainerStyle={listContentStyle}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary[500]}
              colors={[colors.primary[500]]}
            />
          }
        />
      </SafeAreaView>

      {/* Settle picker — outside SafeAreaView so it covers full screen */}
      <SettlePickerSheet
        ref={settlePickerRef}
        friends={friends}
        isLoading={isLoadingFriends}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  offlineEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
  },
  avatarButton: {
    marginLeft: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    borderRadius: 20,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityEmoji: {
    fontSize: 18,
  },
  activityDetails: {
    flex: 1,
    marginLeft: 12,
  },
  activityDescription: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityDate: {
    fontSize: 12,
  },
  activityDot: {
    marginHorizontal: 4,
    fontSize: 12,
  },
  activityGroup: {
    fontSize: 12,
    maxWidth: 80,
  },
  activityAmountContainer: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  activityAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  activityShare: {
    fontSize: 11,
    marginTop: 2,
  },
});

