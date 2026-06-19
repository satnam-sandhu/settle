/**
 * Friends Screen
 * 
 * List of all friends (users shared in groups) with net balance.
 * Shows aggregated balance across all shared groups.
 */

import { Avatar } from '@/components/ui/avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilterScrubber, FRIEND_FILTERS, type FilterType } from '@/components/filter-scrubber';
import { EmptyState } from '@/components/ui/empty-state';
import type { IconSymbolName } from '@/components/ui/icon-symbol-mapping';
import { SkeletonList } from '@/components/ui/skeleton';
import { colors } from '@/constants/colors';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFriends } from '@/hooks/use-friends';
import { useTabBarOffset } from '@/hooks/use-tab-bar-offset';
import { hapticLight, hapticWarning } from '@/lib/haptics';
import { showOfflineAlert } from '@/lib/platform-picker';
import type { Friend } from '@/types';
import { CURRENCIES } from '@/types/database';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function FriendsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { friends, isLoading, error, refresh } = useFriends();
  const { isOnline } = useSync();
  const { scrubberBottom, listPaddingBottom } = useTabBarOffset();
  const listContentStyle = useMemo(
    () => ({ ...styles.listContent, paddingBottom: listPaddingBottom }),
    [listPaddingBottom],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('outstanding');
  const [scrubberVisible, setScrubberVisible] = useState(true);
  const lastScrollY = useRef(0);

  // Filter friends based on active filter
  const displayedFriends = useMemo(() => {
    switch (activeFilter) {
      case 'all':         return friends;
      case 'outstanding': return friends.filter((f) => f.total_balance !== 0);
      case 'i_owe':       return friends.filter((f) => f.total_balance < 0);
      case 'they_owe':    return friends.filter((f) => f.total_balance > 0);
      default:            return friends;
    }
  }, [friends, activeFilter]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    if (y <= 0) { setScrubberVisible(true); return; }
    if (dy > 10) setScrubberVisible(false);
    else if (dy < -10) setScrubberVisible(true);
  }, []);

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Refetch when screen comes into focus (e.g., after adding expense)
  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        refresh();
      }
    }, [isOnline, refresh])
  );

  const handleFriendPress = (friend: Friend) => {
    hapticLight();
    router.push({
      pathname: '/friend/[id]',
      params: { id: friend.user.id, name: friend.user.name },
    });
  };

  const handleAddExpense = (friend: Friend) => {
    // Block ALL offline - view-only mode
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Adding expenses requires an internet connection.');
      return;
    }
    hapticLight();
    router.push({
      pathname: '/add-expense',
      params: { friendId: friend.user.id, friendName: friend.user.name },
    });
  };

  const formatBalance = (balance: number, currency: string) => {
    const currencyInfo = CURRENCIES[currency as keyof typeof CURRENCIES] || CURRENCIES.INR;
    const absBalance = Math.abs(balance).toFixed(2);
    return `${currencyInfo.symbol}${absBalance}`;
  };

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return colors.success;
    if (balance < 0) return colors.error;
    return secondaryTextColor;
  };

  const getBalanceText = (balance: number) => {
    if (balance > 0) return 'owes you';
    if (balance < 0) return 'you owe';
    return 'settled up';
  };


  const renderFriendCard = ({ item, index }: { item: Friend; index: number }) => {
    const balance = item.total_balance;
    const balanceColor = getBalanceColor(balance);

    return (
      <MotiView
        from={{ opacity: 0, translateY: 20, scale: 0.95 }}
        animate={{ opacity: 1, translateY: 0, scale: 1 }}
        transition={{ 
          type: 'spring', 
          damping: 18,
          stiffness: 120,
          delay: Math.min(index * 70, 400),
        }}
      >
        <Pressable
          onPress={() => handleFriendPress(item)}
          style={({ pressed }) => [
            styles.friendCard,
            { 
              backgroundColor: cardBg, 
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {/* Friend Avatar */}
          <Avatar user={item.user} size={48} />

          {/* Friend Info */}
          <View style={styles.friendInfo}>
            <Text style={[styles.friendName, { color: textColor }]} numberOfLines={1}>
              {item.user.name}
            </Text>
            {item.shared_groups > 0 && (
              <Text style={[styles.friendMeta, { color: secondaryTextColor }]}>
                {item.shared_groups} shared group{item.shared_groups !== 1 ? 's' : ''}
              </Text>
            )}
          </View>

          {/* Balance */}
          <View style={styles.balanceContainer}>
            {balance !== 0 ? (
              <>
                <Text style={[styles.balanceLabel, { color: balanceColor }]}>
                  {getBalanceText(balance)}
                </Text>
                <Text style={[styles.balanceAmount, { color: balanceColor }]}>
                  {formatBalance(balance, item.primary_currency)}
                </Text>
              </>
            ) : (
              <View style={[styles.settledBadge, { backgroundColor: colors.gray[100] }]}>
                <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                <Text style={[styles.settledText, { color: colors.success }]}>
                  Settled
                </Text>
              </View>
            )}
          </View>

          {/* Quick Add Button */}
          <Pressable
            onPress={() => handleAddExpense(item)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.addButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <IconSymbol name="plus.circle.fill" size={28} color={colors.primary[500]} />
          </Pressable>
        </Pressable>
      </MotiView>
    );
  };

  const FILTER_EMPTY_MESSAGES: Record<FilterType, { title: string; description: string; icon: IconSymbolName }> = {
    all:         { title: 'No friends yet',     description: 'Add an expense with someone to see them here', icon: 'person.2' },
    outstanding: { title: 'All balanced',       description: 'No outstanding balances right now — nice!',    icon: 'checkmark.circle' },
    i_owe:       { title: 'Nothing to pay',     description: "You don't owe anyone right now.",               icon: 'arrow.up.circle'  },
    they_owe:    { title: 'Nothing to collect', description: 'No one owes you right now.',                    icon: 'arrow.down.circle' },
  };

  const renderEmptyState = () => {
    const hasNoFriendsAtAll = friends.length === 0;
    const msg = hasNoFriendsAtAll
      ? FILTER_EMPTY_MESSAGES.all
      : FILTER_EMPTY_MESSAGES[activeFilter];

    return (
      <AnimatePresence>
        <MotiView
          key={hasNoFriendsAtAll ? 'no-friends' : activeFilter}
          from={{ opacity: 0, scale: 0.94, translateY: 10 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
        >
          <EmptyState
            icon={msg.icon}
            title={msg.title}
            description={msg.description}
            {...(hasNoFriendsAtAll ? {
              actionLabel: 'Add Expense',
              onAction: () => {
                hapticLight();
                router.push('/(tabs)/add');
              },
            } : {})}
          />
        </MotiView>
      </AnimatePresence>
    );
  };

  const renderHeader = () => (
    <MotiView
      from={{ opacity: 0, translateY: -20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 400 }}
      style={styles.header}
    >
      <View>
        <Text style={[styles.headerTitle, { color: textColor }]}>Friends</Text>
        <Text style={[styles.headerSubtitle, { color: secondaryTextColor }]}>
          {displayedFriends.length > 0
            ? `${displayedFriends.length} of ${friends.length} friend${friends.length !== 1 ? 's' : ''}`
            : 'Split and see who owes what'}
        </Text>
      </View>
    </MotiView>
  );

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
        <MotiView
          from={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          style={styles.errorContainer}
        >
          <IconSymbol name="exclamationmark.circle" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: textColor }]}>{error}</Text>
          <Pressable
            onPress={refresh}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: colors.primary[500], opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </MotiView>
      </SafeAreaView>
    );
  }

  // Show offline empty state when no cached data available
  if (!isOnline && !isLoading && friends.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
        {renderHeader()}
        <EmptyState
          icon="icloud.slash"
          title="No cached data"
          description="Connect to the internet to load your friends"
        />
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <FlashList
        data={displayedFriends}
        renderItem={renderFriendCard}
        keyExtractor={(item) => item.user.id}
        contentContainerStyle={listContentStyle}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={4} />
          ) : (
            renderEmptyState()
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[500]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {/* Floating filter scrubber */}
      <View style={[styles.scrubberContainer, { bottom: scrubberBottom }]} pointerEvents="box-none">
        <FilterScrubber
          filters={FRIEND_FILTERS}
          activeFilter={activeFilter}
          onFilterChange={(f) => setActiveFilter(f as FilterType)}
          visible={scrubberVisible}
          isDark={isDark}
        />
      </View>
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  scrubberContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 16,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  friendInfo: {
    flex: 1,
    marginLeft: 12,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
  },
  friendMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  balanceContainer: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'lowercase',
  },
  balanceAmount: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  settledText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addButton: {
    padding: 4,
  },
  separator: {
    height: 10,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    marginTop: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  emptyButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
