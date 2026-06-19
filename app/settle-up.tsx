/**
 * Settle Up Screen
 * 
 * Record a payment to settle debts with a friend.
 * Supports pre-filled amount from friend detail, home settle picker, or search mode.
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar } from '@/components/ui/avatar';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettlements } from '@/hooks/use-settlements';
import { sortSettleTargetsByAbsBalance, type SettleTarget } from '@/hooks/use-settle-targets';
import { hapticLight, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { HeaderIconButton, NativeScreenHeader } from '@/lib/native-header';
import { showPlatformAlert } from '@/lib/platform-picker';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';
import { SETTLEMENT_EVENTS } from '@/lib/analytics-events';
import type { UserSummary } from '@/types';
import { type CurrencyCode } from '@/types/database';

export default function SettleUpScreen() {
  const params = useLocalSearchParams<{
    friendId?: string;
    friendName?: string;
    balance?: string;
    currency?: string;
    groupId?: string;
    entry_point?: string;
  }>();

  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const { isOnline } = useSync();
  const { createSettlement } = useSettlements();

  // Block if offline
  useEffect(() => {
    if (!isOnline) {
      showPlatformAlert(
        'No Connection',
        'Settling up requires an internet connection.',
        'OK',
        () => router.back(),
      );
    }
  }, [isOnline]);

  // Track screen view and settle up started
  useEffect(() => {
    const entryPoint =
      params.entry_point ?? (params.friendId ? 'friend_detail' : 'home_search');
    Analytics.trackScreen('settle_up', { entry_point: entryPoint });
    Analytics.track(SETTLEMENT_EVENTS.SETTLE_UP_STARTED, {
      entry_point: entryPoint,
      has_prefilled_friend: !!params.friendId,
    });
  }, []);

  // State
  const [isSearchMode, setIsSearchMode] = useState(!params.friendId);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SettleTarget[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<SettleTarget | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Colors
  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;
  const inputBg = isDark ? colors.gray[700] : colors.gray[100];
  // Load friend details if coming from friend detail screen
  useEffect(() => {
    if (params.friendId && user) {
      loadFriendBalance(params.friendId);
    }
  }, [params.friendId, user]);

  const loadFriendBalance = async (friendId: string) => {
    if (!user) return;
    
    setBalanceLoading(true);
    try {
      // Get friend info
      const { data: friendData } = await supabase
        .from('users')
        .select('id, name, phone, avatar_url')
        .eq('id', friendId)
        .single();

      // Get balance
      const { data: balance } = await supabase.rpc('calculate_balance_between_users', {
        user1_id: user.id,
        user2_id: friendId,
      });

      if (friendData) {
        const numBalance = Number(balance) || 0;
        setSelectedTarget({
          user: friendData as UserSummary,
          balance: numBalance,
          currency: (params.currency as CurrencyCode) || 'INR',
        });

        // Pre-fill amount with absolute balance
        if (numBalance !== 0) {
          setAmount(Math.abs(numBalance).toFixed(2));
        }
      }
    } catch (err) {
      console.error('[SettleUp] Error loading friend:', err);
    } finally {
      setBalanceLoading(false);
    }
  };

  // Search for friends with non-zero balances
  const searchFriendsWithBalance = useCallback(async (query: string) => {
    if (!user) return;
    
    setIsSearching(true);
    try {
      // Get all groups user is member of
      const { data: memberData } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (!memberData || memberData.length === 0) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      const groupIds = memberData.map((m) => m.group_id);

      // Get all other members in these groups
      const { data: otherMembers } = await supabase
        .from('group_members')
        .select(`
          user_id,
          users:user_id (id, name, phone, avatar_url)
        `)
        .in('group_id', groupIds)
        .neq('user_id', user.id);

      if (!otherMembers) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      // Unique users
      const uniqueUsers = new Map<string, UserSummary>();
      otherMembers.forEach((m) => {
        if (!uniqueUsers.has(m.user_id)) {
          uniqueUsers.set(m.user_id, m.users as unknown as UserSummary);
        }
      });

      // Calculate balance for each and filter non-zero
      const results: SettleTarget[] = [];
      
      for (const [friendId, friendUser] of uniqueUsers.entries()) {
        // Filter by search query
        if (query && !friendUser.name.toLowerCase().includes(query.toLowerCase())) {
          continue;
        }

        const { data: balance } = await supabase.rpc('calculate_balance_between_users', {
          user1_id: user.id,
          user2_id: friendId,
        });

        const numBalance = Number(balance) || 0;
        
        // Only include non-zero balances
        if (numBalance !== 0) {
          results.push({
            user: friendUser,
            balance: numBalance,
            currency: 'INR', // TODO: Get actual currency
          });
        }
      }

      // Sort by absolute balance (highest first)
      setSearchResults(sortSettleTargetsByAbsBalance(results));
    } catch (err) {
      console.error('[SettleUp] Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [user]);

  // Initial load for search mode
  useEffect(() => {
    if (isSearchMode && user) {
      searchFriendsWithBalance('');
    }
  }, [isSearchMode, user, searchFriendsWithBalance]);

  // Handle search
  useEffect(() => {
    if (isSearchMode) {
      const timer = setTimeout(() => {
        searchFriendsWithBalance(searchQuery);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, isSearchMode, searchFriendsWithBalance]);

  const handleSelectTarget = (target: SettleTarget) => {
    hapticLight();
    
    // Track friend selection
    Analytics.track(SETTLEMENT_EVENTS.SETTLE_UP_FRIEND_SELECTED, {
      friend_id: target.user.id,
      balance_direction: target.balance > 0 ? 'they_owe_you' : 'you_owe_them',
      balance_amount: Math.abs(target.balance),
    });
    
    setSelectedTarget(target);
    setIsSearchMode(false);
    // Pre-fill amount
    if (target.balance !== 0) {
      setAmount(Math.abs(target.balance).toFixed(2));
    }
  };

  const handleBack = () => {
    if (selectedTarget && isSearchMode === false && !params.friendId) {
      // Go back to search
      setSelectedTarget(null);
      setIsSearchMode(true);
      setAmount('');
    } else {
      router.back();
    }
  };

  const handleSubmit = async () => {
    if (!selectedTarget || !user) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      hapticWarning();
      showPlatformAlert('Invalid Amount', 'Please enter a valid amount greater than 0');
      return;
    }

    // Determine who pays whom based on balance
    // Positive balance = they owe you, so they pay you
    // Negative balance = you owe them, so you pay them
    const balance = selectedTarget.balance;
    
    // The person who owes is the one who pays
    let paidBy: string;
    let paidTo: string;

    if (balance > 0) {
      // They owe you, so they pay you
      paidBy = selectedTarget.user.id;
      paidTo = user.id;
    } else {
      // You owe them, so you pay them
      paidBy = user.id;
      paidTo = selectedTarget.user.id;
    }

    setIsSubmitting(true);
    console.log('[SettleUp] Creating settlement:', { paidBy, paidTo, amount, currency: selectedTarget.currency });
    try {
      const result = await createSettlement({
        paid_by: paidBy,
        paid_to: paidTo,
        amount: amount,
        currency: selectedTarget.currency,
        group_id: params.groupId || null,
        notes: notes,
      });

      console.log('[SettleUp] Settlement result:', result);

      if (result) {
        // Track successful settlement
        Analytics.track(SETTLEMENT_EVENTS.SETTLE_UP_COMPLETED, {
          amount: parsedAmount,
          currency: selectedTarget.currency,
          direction: balance > 0 ? 'received' : 'paid',
          is_full_settlement: parsedAmount >= Math.abs(balance),
        });
        
        hapticSuccess();
        showPlatformAlert(
          'Settlement Recorded',
          `₹${parsedAmount.toFixed(2)} payment has been recorded.`,
          'OK',
          () => router.back(),
        );
      } else {
        Analytics.track(SETTLEMENT_EVENTS.SETTLE_UP_FAILED);
        console.error('[SettleUp] Settlement failed - no result returned');
        showPlatformAlert('Error', 'Failed to record settlement. Please try again.');
      }
    } catch (err) {
      console.error('[SettleUp] Settlement error:', err);
      showPlatformAlert('Error', 'Failed to record settlement. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };


  const formatBalance = (balance: number) => {
    const absBalance = Math.abs(balance).toFixed(2);
    return `₹${absBalance}`;
  };

  const getBalanceText = (balance: number) => {
    if (balance > 0) return 'owes you';
    if (balance < 0) return 'you owe';
    return 'settled up';
  };

  // Render search results
  const renderSearchResults = () => (
    <View style={styles.searchSection}>
      {/* Search Input */}
      <View style={[styles.searchInputContainer, { backgroundColor: inputBg }]}>
        <IconSymbol name="magnifyingglass" size={20} color={secondaryTextColor} />
        <TextInput
          style={[styles.searchInput, { color: textColor }]}
          placeholder="Search friends..."
          placeholderTextColor={secondaryTextColor}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoFocus
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')}>
            <IconSymbol name="xmark.circle" size={20} color={secondaryTextColor} />
          </Pressable>
        )}
      </View>

      {/* Results */}
      <FlashList
        data={isSearching ? [] : searchResults}
        keyExtractor={(item) => item.user.id}
        renderItem={({ item: result }) => (
          <Pressable
            style={({ pressed }) => [
              styles.resultCard,
              { backgroundColor: cardBg, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => handleSelectTarget(result)}
          >
            <Avatar user={result.user} size={44} />
            <View style={styles.resultInfo}>
              <Text style={[styles.resultName, { color: textColor }]}>{result.user.name}</Text>
              <Text style={[styles.resultBalance, {
                color: result.balance > 0 ? colors.success : colors.error
              }]}>
                {getBalanceText(result.balance)} {formatBalance(result.balance)}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
          </Pressable>
        )}
        ListEmptyComponent={
          isSearching ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary[500]} />
              <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
                Finding friends with balances...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
              <Text style={[styles.emptyTitle, { color: textColor }]}>All Settled Up!</Text>
              <Text style={[styles.emptyText, { color: secondaryTextColor }]}>
                You don't have any pending balances with friends.
              </Text>
            </View>
          )
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.resultsContainer}
      />
    </View>
  );

  // Render settlement form
  const renderSettlementForm = () => {
    if (!selectedTarget) return null;

    const balance = selectedTarget.balance;
    const isSettled = balance === 0;

    // Already settled message
    if (isSettled) {
      return (
        <View style={styles.settledContainer}>
          <View style={[styles.settledIcon, { backgroundColor: colors.success + '20' }]}>
            <IconSymbol name="checkmark.circle.fill" size={64} color={colors.success} />
          </View>
          <Text style={[styles.settledTitle, { color: textColor }]}>
            Already Settled Up!
          </Text>
          <Text style={[styles.settledText, { color: secondaryTextColor }]}>
            You and {selectedTarget.user.name} are all square. No payment needed.
          </Text>
          <Pressable
            style={[styles.doneButton, { backgroundColor: colors.primary[500] }]}
            onPress={() => router.back()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      );
    }

    // Determine direction
    const theyOweYou = balance > 0;
    const directionText = theyOweYou
      ? `${selectedTarget.user.name} pays you`
      : `You pay ${selectedTarget.user.name}`;

    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView style={styles.formContainer} showsVerticalScrollIndicator={false}>
          {/* Friend Info Card */}
          <View style={[styles.friendCard, { backgroundColor: cardBg }]}>
            <Avatar user={selectedTarget.user} size={44} />
            <View style={styles.friendInfo}>
              <Text style={[styles.friendName, { color: textColor }]}>
                {selectedTarget.user.name}
              </Text>
              <Text style={[styles.friendBalance, { 
                color: theyOweYou ? colors.success : colors.error 
              }]}>
                {getBalanceText(balance)} {formatBalance(balance)}
              </Text>
            </View>
          </View>

          {/* Direction Indicator */}
          <View style={[styles.directionCard, { backgroundColor: cardBg }]}>
            <View style={styles.directionRow}>
              <View style={[styles.directionIcon, { backgroundColor: colors.primary[100] }]}>
                <IconSymbol 
                  name={theyOweYou ? 'arrow.down' : 'arrow.up'} 
                  size={20} 
                  color={colors.primary[500]} 
                />
              </View>
              <Text style={[styles.directionText, { color: textColor }]}>
                {directionText}
              </Text>
            </View>
          </View>

          {/* Amount Input */}
          <View style={[styles.inputCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.inputLabel, { color: secondaryTextColor }]}>Amount</Text>
            <View style={styles.amountRow}>
              <Text style={[styles.currencySymbol, { color: textColor }]}>₹</Text>
              <TextInput
                style={[styles.amountInput, { color: textColor }]}
                placeholder="0.00"
                placeholderTextColor={secondaryTextColor}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
            </View>
            <Text style={[styles.inputHint, { color: secondaryTextColor }]}>
              Outstanding: {formatBalance(balance)}
            </Text>
          </View>

          {/* Notes Input */}
          <View style={[styles.inputCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.inputLabel, { color: secondaryTextColor }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.notesInput, { color: textColor, backgroundColor: inputBg }]}
              placeholder="e.g., Paid via UPI"
              placeholderTextColor={secondaryTextColor}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Submit Button */}
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              { backgroundColor: colors.primary[500], opacity: pressed ? 0.8 : 1 },
              isSubmitting && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <IconSymbol name="checkmark.circle.fill" size={20} color={colors.white} />
                <Text style={styles.submitButtonText}>Record Payment</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </TouchableWithoutFeedback>
    );
  };

  if (balanceLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader
          title="Settle Up"
          headerBackVisible={false}
          headerLeft={<HeaderIconButton icon="chevron.left" onPress={handleBack} />}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
      <NativeScreenHeader
        title="Settle Up"
        headerBackVisible={false}
        headerLeft={<HeaderIconButton icon="chevron.left" onPress={handleBack} />}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {isSearchMode ? renderSearchResults() : renderSettlementForm()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  
  // Search Section
  searchSection: {
    flex: 1,
    padding: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  resultsContainer: {
    flex: 1,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  resultInfo: {
    flex: 1,
    marginLeft: 12,
  },
  resultName: {
    fontSize: 16,
    fontWeight: '600',
  },
  resultBalance: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
  },

  // Settlement Form
  formContainer: {
    flex: 1,
    padding: 16,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  friendInfo: {
    flex: 1,
    marginLeft: 12,
  },
  friendName: {
    fontSize: 18,
    fontWeight: '600',
  },
  friendBalance: {
    fontSize: 14,
    marginTop: 2,
  },
  directionCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  directionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionText: {
    fontSize: 16,
    fontWeight: '500',
  },
  inputCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '600',
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '600',
  },
  inputHint: {
    fontSize: 12,
    marginTop: 8,
  },
  notesInput: {
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
    marginBottom: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },

  // Settled State
  settledContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  settledIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  settledTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  settledText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
  },
  doneButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  doneButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
