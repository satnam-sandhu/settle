/**
 * SettlePickerSheet
 *
 * Global settle picker for Home summary card. Lists friends with outstanding
 * balances from useFriends — no duplicate RPC loop (unlike GroupSettleSheet).
 *
 * Pattern references:
 *   - GroupSettleSheet — sectioned you-owe / they-owe layout
 *   - PeopleSearchSheet — BottomSheet + SheetBackground + search field
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import BottomSheet, { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { forwardRef, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { SheetBackground } from '@/components/ui/sheet-background';
import { colors } from '@/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettleTargets, type SettleTarget } from '@/hooks/use-settle-targets';
import { hapticLight } from '@/lib/haptics';
import { formatCurrency } from '@/lib/utils';
import type { Friend } from '@/types';

export interface SettlePickerSheetProps {
  friends: Friend[];
  isLoading: boolean;
  onClose?: () => void;
}

export const SettlePickerSheet = forwardRef<BottomSheet, SettlePickerSheetProps>(
  ({ friends, isLoading, onClose }, ref) => {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['55%', '80%'], []);

    const [searchQuery, setSearchQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [shouldFocusSearch, setShouldFocusSearch] = useState(false);

    const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
    const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
    const dividerColor = isDark ? colors.gray[700] : colors.gray[200];
    const inputBg = isDark ? colors.gray[800] : colors.gray[100];

    const { youOwe, youGetBack } = useSettleTargets(friends, searchQuery);
    const hasResults = youOwe.length > 0 || youGetBack.length > 0;

    const sheetStyle = useMemo(
      () =>
        isOpen
          ? {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -6 },
              shadowOpacity: 0.12,
              shadowRadius: 16,
              elevation: 20,
            }
          : undefined,
      [isOpen]
    );

    const closeSheet = useCallback(() => {
      if (ref && typeof ref !== 'function' && ref.current) {
        ref.current.close();
      }
    }, [ref]);

    const handleSheetChange = useCallback(
      (index: number) => {
        const opened = index >= 0;
        setIsOpen(opened);

        if (opened) {
          // BottomSheetTextInput autoFocus only applies on mount; remount on open.
          setShouldFocusSearch(true);
        } else {
          setSearchQuery('');
          setShouldFocusSearch(false);
          onClose?.();
        }
      },
      [onClose]
    );

    const handleSelect = useCallback(
      (target: SettleTarget) => {
        hapticLight();
        closeSheet();
        router.push({
          pathname: '/settle-up',
          params: {
            friendId: target.user.id,
            friendName: target.user.name,
            balance: target.balance.toString(),
            currency: target.currency,
            entry_point: 'home_summary_card',
          },
        });
      },
      [closeSheet]
    );

    const renderRow = useCallback(
      (target: SettleTarget) => {
        const isDebt = target.balance < 0;
        const balanceColor = isDebt ? colors.error : colors.success;
        const balanceLabel = isDebt
          ? `you owe ${formatCurrency(Math.abs(target.balance), target.currency)}`
          : `owes you ${formatCurrency(target.balance, target.currency)}`;

        return (
          <Pressable
            key={target.user.id}
            onPress={() => handleSelect(target)}
            style={({ pressed }) => [
              styles.row,
              { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Avatar user={target.user} size={44} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                {target.user.name}
              </Text>
              <Text style={[styles.rowBalance, { color: balanceColor }]}>{balanceLabel}</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
          </Pressable>
        );
      },
      [handleSelect, secondaryTextColor, textColor]
    );

    const renderContent = () => {
      if (isLoading) {
        return (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.primary[500]} />
            <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
              Loading balances…
            </Text>
          </View>
        );
      }

      if (!hasResults) {
        return (
          <View style={styles.centered}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.success + '20' }]}>
              <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
            </View>
            <Text style={[styles.emptyTitle, { color: textColor }]}>No outstanding balances</Text>
            <Text style={[styles.emptySub, { color: secondaryTextColor }]}>
              {searchQuery
                ? 'No friends match your search.'
                : 'You are all settled up with everyone.'}
            </Text>
          </View>
        );
      }

      return (
        <>
          {youOwe.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>You owe</Text>
              {youOwe.map(renderRow)}
            </View>
          )}

          {youOwe.length > 0 && youGetBack.length > 0 && (
            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          )}

          {youGetBack.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>
                You get back
              </Text>
              {youGetBack.map(renderRow)}
            </View>
          )}
        </>
      );
    };

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        bottomInset={insets.bottom}
        enablePanDownToClose
        enableOverDrag={false}
        enableDynamicSizing={false}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        style={sheetStyle}
        onChange={handleSheetChange}
        backgroundComponent={SheetBackground}
        backgroundStyle={{ backgroundColor: 'transparent' }}
        handleIndicatorStyle={{ backgroundColor: colors.gray[400] }}
      >
        <BottomSheetScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 24) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>Settle up</Text>
            <Text style={[styles.subtitle, { color: secondaryTextColor }]}>
              Choose who you want to settle with.
            </Text>
          </View>

          <View style={[styles.searchBox, { backgroundColor: inputBg }]}>
            <IconSymbol name="magnifyingglass" size={20} color={secondaryTextColor} />
            <BottomSheetTextInput
              key={shouldFocusSearch ? 'search-focused' : 'search-idle'}
              autoFocus={shouldFocusSearch}
              placeholder="Search friends..."
              placeholderTextColor={secondaryTextColor}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { color: textColor }]}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery('')}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <IconSymbol name="xmark.circle" size={20} color={secondaryTextColor} />
              </Pressable>
            )}
          </View>

          {renderContent()}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

SettlePickerSheet.displayName = 'SettlePickerSheet';

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  section: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 4,
  },
  divider: {
    height: 1,
    marginVertical: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowBalance: {
    fontSize: 13,
    marginTop: 2,
  },
});
