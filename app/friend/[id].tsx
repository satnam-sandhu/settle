/**
 * Friend Detail Screen
 * 
 * Shows all transactions (expenses and settlements) with a specific friend.
 * Groups by shared group first, then shows individual transaction history.
 */

import { EditSettlementSheet } from '@/components/edit-settlement-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import BottomSheet from '@gorhom/bottom-sheet';
import { Avatar } from '@/components/ui/avatar';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonActivityList, SkeletonCard } from '@/components/ui/skeleton';
import { colors } from '@/constants/colors';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFriendDetail, type GroupBalance } from '@/hooks/use-friend-detail';
import { useSettlements } from '@/hooks/use-settlements';
import { hapticLight, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { Analytics } from '@/lib/analytics';
import { FRIEND_EVENTS } from '@/lib/analytics-events';
import { NativeScreenHeader } from '@/lib/native-header';
import { showOfflineAlert, showPlatformAlert } from '@/lib/platform-picker';
import type { FriendTransaction } from '@/types';
import { CURRENCIES } from '@/types/database';

// ─── Flat list item types ─────────────────────────────────────────────────────

type FriendActivityItem =
  | { kind: 'transaction'; data: FriendTransaction; listIndex: number }
  | { kind: 'view_older' }
  | { kind: 'fully_settled'; showViewHistory: boolean }
  | { kind: 'empty_transactions' };

// ─────────────────────────────────────────────────────────────────────────────

export default function FriendDetailScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { isOnline } = useSync();
  const {
    friend,
    groupBalances,
    currentPhase,
    olderPhases,
    isFullySettled,
    hasMoreOlder,
    loadOlderPhase,
    promoteCurrentPhase,
    isLoadingOlder,
    isLoading,
    error,
    refresh,
  } = useFriendDetail(params.id);
  const { updateSettlement } = useSettlements({ friendId: params.id });
  const [refreshing, setRefreshing] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<FriendTransaction | null>(null);

  // Track friend viewed
  useEffect(() => {
    Analytics.track(FRIEND_EVENTS.FRIEND_VIEWED, { friend_id: params.id });
  }, [params.id]);
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const editSheetRef = useRef<BottomSheet>(null);

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;
  const settlementLineColor = isDark ? colors.gray[600] : colors.gray[300];
  const settlementTextColor = textColor; // Neutral solid color, no green/red

  // ─── Flat activity data array for FlashList ───────────────────────────────

  const activityItems = useMemo<FriendActivityItem[]>(() => {
    const items: FriendActivityItem[] = [];

    if (isFullySettled) {
      items.push({ kind: 'fully_settled', showViewHistory: olderPhases.length === 0 && (hasMoreOlder || currentPhase.length > 0) });
    } else {
      currentPhase.forEach((tx, idx) => items.push({ kind: 'transaction', data: tx, listIndex: idx }));
    }

    olderPhases.forEach((phase, phaseIdx) => {
      phase.forEach((tx, txIdx) => {
        items.push({ kind: 'transaction', data: tx, listIndex: currentPhase.length + phaseIdx * 100 + txIdx });
      });
    });

    if (hasMoreOlder && (!isFullySettled || olderPhases.length > 0)) {
      items.push({ kind: 'view_older' });
    }

    if (items.length === 0 && !isLoading) {
      items.push({ kind: 'empty_transactions' });
    }

    return items;
  }, [currentPhase, olderPhases, isFullySettled, hasMoreOlder, isLoading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleAddExpense = () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Adding expenses requires an internet connection.');
      return;
    }
    hapticLight();
    router.push({
      pathname: '/add-expense',
      params: { friendId: params.id, friendName: friend?.user.name || params.name },
    });
  };

  const handleSettleUp = () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Settling up requires an internet connection.');
      return;
    }
    hapticLight();
    router.push({
      pathname: '/settle-up',
      params: { 
        friendId: params.id, 
        friendName: friend?.user.name || params.name,
        balance: friend?.total_balance?.toString(),
        currency: friend?.primary_currency,
        entry_point: 'friend_detail',
      },
    });
  };

  const handleGroupPress = (groupId: string) => {
    hapticLight();
    router.push(`/group/${groupId}`);
  };


  const formatBalance = (balance: number, currency: string = 'INR') => {
    const currencyInfo = CURRENCIES[currency as keyof typeof CURRENCIES] || CURRENCIES.INR;
    const absBalance = Math.abs(balance).toFixed(2);
    return `${currencyInfo.symbol}${absBalance}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const formatSettlementDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return colors.success;
    if (balance < 0) return colors.error;
    return secondaryTextColor;
  };

  const getBalanceText = (balance: number) => {
    if (balance > 0) return 'owes you';
    if (balance < 0) return 'you owe';
    return 'All settled up';
  };

  const renderGroupCard = (groupBalance: GroupBalance, index: number) => {
    return (
      <MotiView
        key={groupBalance.group_id}
        from={{ opacity: 0, translateX: -20, scale: 0.95 }}
        animate={{ opacity: 1, translateX: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 120, delay: Math.min(index * 70, 350) }}
      >
        <Pressable
          onPress={() => handleGroupPress(groupBalance.group_id)}
          style={({ pressed }) => [
            styles.groupCard,
            {
              backgroundColor: cardBg,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          <Avatar
            group={{ name: groupBalance.group_name, image_url: groupBalance.image_url }}
            size={40}
          />
          <View style={styles.groupInfo}>
            <Text style={[styles.groupName, { color: textColor }]} numberOfLines={1}>
              {groupBalance.group_name}
            </Text>
            <Text style={[styles.groupMeta, { color: secondaryTextColor }]}>
              {groupBalance.transaction_count} transaction{groupBalance.transaction_count !== 1 ? 's' : ''}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
        </Pressable>
      </MotiView>
    );
  };

  const handleTransactionPress = (item: FriendTransaction) => {
    if (item.type === 'expense') {
      hapticLight();
      router.push(`/expense/${item.id}`);
      return;
    }
    if (item.type === 'expense_group') {
      hapticLight();
      router.push(`/expense/group/${item.id}`);
    }
  };

  const handleSettlementPress = (item: FriendTransaction) => {
    if (item.type !== 'settlement') return;
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Editing settlements requires an internet connection.');
      return;
    }
    hapticLight();
    setEditingSettlement(item);
    setEditAmount(Math.abs(item.amount).toFixed(2));
    setEditNotes(item.notes || '');
    editSheetRef.current?.expand();
  };

  const handleCloseEditSheet = useCallback(() => {
    editSheetRef.current?.close();
    setEditingSettlement(null);
    setEditAmount('');
    setEditNotes('');
  }, []);

  const handleUpdateSettlement = async () => {
    if (!editingSettlement) return;
    const amountNum = parseFloat(editAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      hapticWarning();
      return;
    }
    setIsUpdating(true);
    const success = await updateSettlement(editingSettlement.id, {
      amount: amountNum,
      notes: editNotes.trim() || null,
    });
    setIsUpdating(false);
    if (success) {
      hapticSuccess();
      handleCloseEditSheet();
      refresh();
    } else {
      hapticWarning();
      showPlatformAlert('Error', 'Failed to update settlement. Please try again.');
    }
  };

  const renderTransactionItem = (item: FriendTransaction, index: number) => {
    const isPositive = item.amount > 0;
    const isSettlement = item.type === 'settlement';
    const friendName = friend?.user.name || params.name || 'Friend';

    // Settlement: thin line with neutral text, tappable to edit
    if (isSettlement) {
      const dateStr = formatSettlementDate(item.date);
      const settlementText =
        item.amount > 0
          ? `${friendName} paid you ${formatBalance(item.amount, item.currency)} on ${dateStr}`
          : `you paid ${friendName} ${formatBalance(Math.abs(item.amount), item.currency)} on ${dateStr}`;

      return (
        <MotiView
          key={item.id}
          from={{ opacity: 0, translateX: -20 }}
          animate={{ opacity: 1, translateX: 0 }}
          transition={{ type: 'spring', damping: 18, stiffness: 120, delay: Math.min(index * 50, 300) }}
        >
          <Pressable
            onPress={() => handleSettlementPress(item)}
            style={({ pressed }) => [
              styles.settlementContainer,
              { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <View style={[styles.settlementLine, { backgroundColor: settlementLineColor }]} />
            <Text style={[styles.settlementText, { color: settlementTextColor }]} numberOfLines={1}>
              {settlementText}
            </Text>
            <View style={[styles.settlementLine, { backgroundColor: settlementLineColor }]} />
          </Pressable>
        </MotiView>
      );
    }

    // Expense or expense_group: card layout with colors
    const amountColor = isPositive ? colors.success : colors.error;
    const amountLabel = isPositive ? 'you get' : 'you owe';

    const content = (
      <View style={[styles.transactionItem, { backgroundColor: cardBg }]}>
        {/* Icon */}
        <View
          style={[
            styles.transactionIcon,
            {
              backgroundColor: item.category_color
                ? item.category_color + '20'
                : isPositive ? colors.success + '20' : colors.error + '20',
            },
          ]}
        >
          {item.category_icon ? (
            <Text style={styles.transactionIconEmoji}>{item.category_icon}</Text>
          ) : (
            <IconSymbol
              name="doc.text"
              size={18}
              color={isPositive ? colors.success : colors.error}
            />
          )}
        </View>

        {/* Details */}
        <View style={styles.transactionDetails}>
          <Text style={[styles.transactionDescription, { color: textColor }]} numberOfLines={1}>
            {item.description}
          </Text>
          <View style={styles.transactionMeta}>
            <Text style={[styles.transactionDate, { color: secondaryTextColor }]}>
              {item.paid_by_you ? 'You paid' : `${friendName.split(' ')[0]} paid`}
            </Text>
            <Text style={[styles.transactionDot, { color: secondaryTextColor }]}>•</Text>
            <Text style={[styles.transactionDate, { color: secondaryTextColor }]}>
              {formatDate(item.date)}
            </Text>
            {item.group_type === 'group' && item.group_name && (
              <>
                <Text style={[styles.transactionDot, { color: secondaryTextColor }]}>•</Text>
                <IconSymbol name="person.2.fill" size={11} color={secondaryTextColor} />
                <Text style={[styles.transactionGroup, { color: secondaryTextColor }]} numberOfLines={1}>
                  {item.group_name}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Amount */}
        <View style={styles.transactionAmountContainer}>
          <Text style={[styles.transactionAmountLabel, { color: amountColor }]}>
            {amountLabel}
          </Text>
          <Text style={[styles.transactionAmount, { color: amountColor }]}>
            {formatBalance(item.amount, item.currency)}
          </Text>
        </View>

        <IconSymbol name="chevron.right" size={16} color={secondaryTextColor} style={{ marginLeft: 4 }} />
      </View>
    );

    return (
      <MotiView
        key={item.id}
        from={{ opacity: 0, translateX: -20, scale: 0.95 }}
        animate={{ opacity: 1, translateX: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 120, delay: Math.min(index * 50, 300) }}
      >
        <Pressable
          onPress={() => handleTransactionPress(item)}
          style={({ pressed }) => ({
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          {content}
        </Pressable>
      </MotiView>
    );
  };

  const renderViewOlderButton = useCallback(() => (
    <View style={styles.viewOlderContainer}>
      <Pressable
        onPress={loadOlderPhase}
        disabled={isLoadingOlder}
      >
        {({ pressed }) => (
          <MotiView
            animate={{ scale: pressed ? 0.95 : 1, opacity: pressed ? 0.75 : 1 }}
            transition={{ type: 'spring', damping: 18, stiffness: 300 }}
            style={styles.viewOlderPill}
          >
            {isLoadingOlder ? (
              <ActivityIndicator size="small" color={colors.primary[500]} />
            ) : (
              <Text style={[styles.viewOlderText, { color: colors.primary[500] }]}>
                View older expenses
              </Text>
            )}
          </MotiView>
        )}
      </Pressable>
    </View>
  ), [loadOlderPhase, isLoadingOlder]);

  const renderFullySettledState = useCallback((showViewHistory: boolean) => {
    const friendName = friend?.user.name || params.name || 'Friend';
    return (
      <MotiView
        from={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 180, delay: 100 }}
        style={[styles.settledState, { backgroundColor: cardBg }]}
      >
        {/* Pulsing checkmark — signals "done", keeps the state alive */}
        <MotiView
          from={{ scale: 1 }}
          animate={{ scale: 1.08 }}
          transition={{ type: 'timing', duration: 900, loop: true, repeatReverse: true }}
        >
          <View style={[styles.settledStateIcon, { backgroundColor: colors.success + '20' }]}>
            <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
          </View>
        </MotiView>

        {/* Staggered text — enters 150ms after the icon */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 18, stiffness: 200, delay: 250 }}
          style={{ alignItems: 'center', alignSelf: 'stretch' }}
        >
          <Text style={[styles.settledStateTitle, { color: textColor }]}>
            All settled up!
          </Text>
          <Text style={[styles.settledStateText, { color: secondaryTextColor }]}>
            You and {friendName.split(' ')[0]} are all square.
          </Text>
        </MotiView>

        {/* View history — fades in last */}
        {showViewHistory && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300, delay: 450 }}
            style={{ alignItems: 'center' }}
          >
            <Pressable onPress={promoteCurrentPhase} style={{ marginTop: 12 }}>
              {({ pressed }) => (
                <MotiView
                  animate={{ scale: pressed ? 0.95 : 1, opacity: pressed ? 0.75 : 1 }}
                  transition={{ type: 'spring', damping: 18, stiffness: 300 }}
                  style={styles.viewOlderPill}
                >
                  <Text style={[styles.viewOlderText, { color: colors.primary[500] }]}>
                    View history
                  </Text>
                </MotiView>
              )}
            </Pressable>
          </MotiView>
        )}
      </MotiView>
    );
  }, [cardBg, textColor, secondaryTextColor, friend?.user.name, params.name, promoteCurrentPhase]);

  const renderEmptyTransactions = useCallback(() => (
    <View style={[styles.emptyState, { backgroundColor: cardBg }]}>
      <EmptyState
        icon="creditcard"
        title="No transactions yet"
        description="Add an expense to start tracking your shared expenses with this friend"
        compact
      />
    </View>
  ), [cardBg]);

  const renderFriendActivityItem = useCallback(({ item }: { item: FriendActivityItem }) => {
    if (item.kind === 'transaction') return renderTransactionItem(item.data, item.listIndex);
    if (item.kind === 'view_older') return renderViewOlderButton();
    if (item.kind === 'fully_settled') return renderFullySettledState(item.showViewHistory);
    if (item.kind === 'empty_transactions') return renderEmptyTransactions();
    return null;
  }, [renderTransactionItem, renderViewOlderButton, renderFullySettledState, renderEmptyTransactions]);

  const renderListHeader = useCallback(() => {
    const friendName = friend?.user.name || params.name || 'Friend';
    const balance = friend?.total_balance || 0;
    const balanceColor = getBalanceColor(balance);

    return (
      <>
        {/* Friend Info Card — horizontal, matching group detail layout */}
        <MotiView
          from={{ opacity: 0, translateY: 20, scale: 0.95 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 18, stiffness: 120, delay: 100 }}
          style={[styles.friendInfoCard, { backgroundColor: cardBg }]}
        >
          {friend && <Avatar user={friend.user} size={60} />}
          <View style={styles.friendDetails}>
            <Text style={[styles.friendName, { color: textColor }]} numberOfLines={1}>
              {friendName}
            </Text>
            {balance === 0 ? (
              <View style={styles.settledLine}>
                <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                <Text style={[styles.friendBalanceLine, { color: colors.success, marginLeft: 4 }]}>
                  All settled up
                </Text>
              </View>
            ) : (
              <Text style={[styles.friendBalanceLine, { color: balanceColor }]} numberOfLines={1}>
                {`${getBalanceText(balance)} ${formatBalance(balance, friend?.primary_currency)}`}
              </Text>
            )}
          </View>
          {balance !== 0 && (
            <Pressable
              onPress={handleSettleUp}
              style={({ pressed }) => [
                styles.settleUpPill,
                { borderColor: colors.primary[500], opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
            >
              <IconSymbol name="arrow.left.arrow.right" size={15} color={colors.primary[500]} />
              <Text style={[styles.settleUpPillText, { color: colors.primary[500] }]}>Settle</Text>
            </Pressable>
          )}
        </MotiView>

        {/* Shared Groups Section */}
        {groupBalances.length > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 18, stiffness: 120, delay: 180 }}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>Shared Groups</Text>
              <Text style={[styles.sectionSubtitle, { color: secondaryTextColor }]}>
                {groupBalances.length} group{groupBalances.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.groupsList}>
              {groupBalances.map((gb, index) => renderGroupCard(gb, index))}
            </View>
          </MotiView>
        )}

        {/* Activity Section Header with inline + Add button */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 18, stiffness: 120, delay: 260 }}
          style={styles.activityHeader}
        >
          <Text style={[styles.sectionTitle, { color: textColor }]}>Activity</Text>
          <Pressable
            onPress={handleAddExpense}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.primary[500], opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <IconSymbol name="plus" size={18} color={colors.white} />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </MotiView>
      </>
    );
  }, [
    friend, params.name, cardBg, textColor, secondaryTextColor,
    groupBalances, handleAddExpense, handleSettleUp, renderGroupCard,
  ]);

  const screenTitle = friend?.user.name || params.name || 'Friend';

  if (isLoading && !friend) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={params.name || 'Friend'} />
        <View style={styles.loadingContainer}>
          {/* Friend info skeleton — horizontal */}
          <View style={[styles.friendInfoCard, { backgroundColor: cardBg }]}>
            <Skeleton width={60} height={60} circle />
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Skeleton width={120} height={18} borderRadius={6} />
              <View style={{ height: 8 }} />
              <Skeleton width={160} height={14} borderRadius={4} />
            </View>
            <Skeleton width={72} height={32} borderRadius={16} />
          </View>

          {/* Groups skeleton */}
          <View style={{ paddingHorizontal: 0 }}>
            <Skeleton width={120} height={16} borderRadius={4} />
            <View style={{ height: 16 }} />
            <SkeletonCard />
          </View>

          {/* Activity skeleton */}
          <View style={{ marginTop: 20 }}>
            <Skeleton width={80} height={16} borderRadius={4} />
            <View style={{ height: 16 }} />
            <SkeletonActivityList count={3} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title="Error" />
        <MotiView
          from={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          style={styles.errorContainer}
        >
          <IconSymbol name="exclamationmark.circle" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: textColor }]}>{error}</Text>
          <Pressable onPress={refresh}>
            {({ pressed }) => (
              <MotiView
                animate={{ scale: pressed ? 0.95 : 1, opacity: pressed ? 0.85 : 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 300 }}
                style={[styles.retryButton, { backgroundColor: colors.primary[500] }]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </MotiView>
            )}
          </Pressable>
        </MotiView>
      </SafeAreaView>
    );
  }

  // Show offline empty state when no cached data available
  if (!isOnline && !isLoading && !friend) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={params.name || 'Friend'} />
        <View style={styles.errorContainer}>
          <EmptyState
            icon="icloud.slash"
            title="No cached data"
            description="Connect to the internet to view this friend's details"
          />
        </View>
      </SafeAreaView>
    );
  }

  const currencySymbol = CURRENCIES[friend?.primary_currency || 'INR']?.symbol || '₹';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={screenTitle} />

        <FlashList
          data={activityItems}
          renderItem={renderFriendActivityItem}
          keyExtractor={(item, index) => {
            if (item.kind === 'transaction') return item.data.id;
            if (item.kind === 'view_older') return 'view-older';
            if (item.kind === 'fully_settled') return 'fully-settled';
            return `empty-${index}`;
          }}
          getItemType={(item) => item.kind}
          ListHeaderComponent={renderListHeader()}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[500]}
            />
          }
        />

        <EditSettlementSheet
          ref={editSheetRef}
          amount={editAmount}
          notes={editNotes}
          onAmountChange={setEditAmount}
          onNotesChange={setEditNotes}
          onCancel={handleCloseEditSheet}
          onUpdate={handleUpdateSettlement}
          isUpdating={isUpdating}
          currencySymbol={currencySymbol}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  friendInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  friendDetails: {
    flex: 1,
    marginLeft: 16,
  },
  friendName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  friendBalanceLine: {
    fontSize: 14,
    fontWeight: '500',
  },
  settledLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settleUpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 4,
  },
  settleUpPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 4,
  },
  addButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  sectionSubtitle: {
    fontSize: 13,
  },
  groupsList: {
    gap: 10,
    marginBottom: 24,
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  groupInfo: {
    flex: 1,
    marginLeft: 12,
  },
  groupName: {
    fontSize: 15,
    fontWeight: '600',
  },
  groupMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  groupBalanceContainer: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  groupBalanceLabel: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  groupBalanceAmount: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  settledBadgeSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  settledTextSmall: {
    fontSize: 11,
    fontWeight: '600',
  },
  transactionsList: {
    gap: 8,
  },
  settledState: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 16,
    marginBottom: 16,
  },
  settledStateIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  settledStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  settledStateText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
  },
  viewOlderContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  viewOlderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  viewOlderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: colors.primary[500] + '28',
    borderWidth: 1.5,
    borderColor: colors.primary[500] + '70',
  },
  viewOlderText: {
    fontSize: 13,
    fontWeight: '600',
  },
  settlementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  settlementLine: {
    flex: 1,
    height: 1,
  },
  settlementText: {
    fontSize: 13,
    fontWeight: '500',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  transactionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionIconEmoji: {
    fontSize: 18,
  },
  transactionDetails: {
    flex: 1,
    marginLeft: 10,
  },
  transactionDescription: {
    fontSize: 14,
    fontWeight: '500',
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  transactionDate: {
    fontSize: 11,
  },
  transactionDot: {
    marginHorizontal: 5,
    fontSize: 11,
  },
  transactionGroup: {
    fontSize: 11,
    maxWidth: 80,
  },
  transactionAmountContainer: {
    alignItems: 'flex-end',
  },
  transactionAmountLabel: {
    fontSize: 9,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 1,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    padding: 16,
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
