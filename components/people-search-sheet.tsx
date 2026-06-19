/**
 * PeopleSearchSheet
 *
 * Unified bottom sheet for searching and selecting contacts and/or groups.
 * Powered by useEnrichedContacts — shows real profile photos for in-app users.
 *
 * Modes:
 *   Multi-select  (create-group, group settings) — checkboxes, Done button,
 *                  contacts only
 *   Group+contact  (add-expense)                 — showGroups=true,
 *                  single tap calls onGroupSelect or onContactSelect
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import BottomSheet, { BottomSheetFlashList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { MotiView } from 'moti';
import { forwardRef, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { SheetBackground } from '@/components/ui/sheet-background';
import { Checkbox } from '@/components/ui/checkbox';
import { SkeletonContactList } from '@/components/ui/skeleton';
import { colors } from '@/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SearchResultGroup } from '@/hooks/use-contact-group-search';
import type { EnrichedContact } from '@/hooks/use-enriched-contacts';
import { useEnrichedContacts } from '@/hooks/use-enriched-contacts';
import { useFriends } from '@/hooks/use-friends';
import type {
  OutstandingTarget,
  RecentExpenseTarget,
} from '@/hooks/use-recent-expense-targets';
import { formatCurrency } from '@/lib/utils';
import type { Friend, GroupListItem } from '@/types';

// ─── List item union ──────────────────────────────────────────────────────────

type SectionHeaderItem = { _type: 'sectionHeader'; label: string };
type GroupListItemRow = { _type: 'group'; data: SearchResultGroup };
type ContactListItem = { _type: 'contact'; data: EnrichedContact };
type RecentListItem = { _type: 'recent'; data: RecentExpenseTarget };
type OutstandingFriendListItem = { _type: 'outstandingFriend'; data: Friend };
type OutstandingGroupListItem = { _type: 'outstandingGroup'; data: GroupListItem };
type ListItem =
  | SectionHeaderItem
  | GroupListItemRow
  | ContactListItem
  | RecentListItem
  | OutstandingFriendListItem
  | OutstandingGroupListItem;

function friendToEnrichedContact(friend: Friend): EnrichedContact {
  return {
    id: friend.user.id,
    name: friend.user.name,
    phone: friend.user.phone ?? '',
    userId: friend.user.id,
    avatarUrl: friend.user.avatar_url,
    hasDirectGroup: friend.hasDirectGroup ?? false,
  };
}

function groupListItemToSearchGroup(group: GroupListItem): SearchResultGroup {
  return {
    type: 'group',
    id: group.id,
    name: group.name,
    image_url: group.image_url,
    memberCount: group.member_count,
  };
}

function getBalanceLabel(balance: number): { text: string; color: string } {
  if (balance > 0) {
    return {
      text: `you get back ${formatCurrency(balance)}`,
      color: colors.success,
    };
  }
  return {
    text: `you owe ${formatCurrency(Math.abs(balance))}`,
    color: colors.error,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PeopleSearchSheetProps {
  /**
   * Fired on every contact row tap.
   * In multi-select the parent owns state and toggles the item;
   * in single-select the parent should close the sheet after this.
   */
  onContactSelect: (contact: EnrichedContact) => void;
  /** Controlled selected-contact IDs; drives checkbox visuals */
  selectedIds?: Set<string>;
  /** Show the current user's regular groups above contacts (default: false) */
  showGroups?: boolean;
  /** Fired when a group row is tapped */
  onGroupSelect?: (group: SearchResultGroup) => void;
  /** Tiered Recent / Outstanding sections when search is empty (global add sheet) */
  showRecentsTier?: boolean;
  recentTargets?: RecentExpenseTarget[];
  outstandingTargets?: OutstandingTarget[];
  recordRecentTarget?: (target: Pick<RecentExpenseTarget, 'type' | 'id' | 'name'>) => void;
  /** Focus search field when the sheet opens */
  autoFocusSearch?: boolean;
  /** Sheet index changes (-1 closed, 0+ open) */
  onSheetChange?: (index: number) => void;
  title?: string;
  /** When provided, a "Done" button appears in the header */
  doneText?: string;
  onClose?: () => void;
  /** Fired when the close animation begins (before it completes) */
  onStartClose?: () => void;
  onDone?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PeopleSearchSheet = forwardRef<BottomSheet, PeopleSearchSheetProps>(
  (
    {
      onContactSelect,
      selectedIds,
      showGroups = false,
      onGroupSelect,
      showRecentsTier = false,
      recentTargets = [],
      outstandingTargets = [],
      recordRecentTarget,
      autoFocusSearch = false,
      onSheetChange,
      title = 'Add Members',
      doneText,
      onClose,
      onStartClose,
      onDone,
    },
    ref
  ) => {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';
    const snapPoints = useMemo(() => ['90%'], []);
    const [searchQuery, setSearchQuery] = useState('');
    const [shouldFocusSearch, setShouldFocusSearch] = useState(false);

    const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
    const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
    const sheetBg = isDark ? colors.gray[900] : colors.white;

    const { contacts, groups, isLoading, hasContactPermission, loadInitialData } =
      useEnrichedContacts();
    const { friends } = useFriends();

    useEffect(() => {
      loadInitialData();
    }, [loadInitialData]);

    const handleGroupPress = useCallback(
      (group: SearchResultGroup) => {
        if (showRecentsTier) {
          recordRecentTarget?.({ type: 'group', id: group.id, name: group.name });
        }
        onGroupSelect?.(group);
      },
      [showRecentsTier, recordRecentTarget, onGroupSelect]
    );

    const handleContactPress = useCallback(
      (contact: EnrichedContact) => {
        onContactSelect(contact);
      },
      [onContactSelect]
    );

    const handleRecentPress = useCallback(
      (target: RecentExpenseTarget) => {
        if (target.type === 'group') {
          const group = groups.find(item => item.id === target.id);
          if (group) {
            handleGroupPress(group);
            return;
          }
          handleGroupPress({
            type: 'group',
            id: target.id,
            name: target.name,
            image_url: null,
            memberCount: 0,
          });
          return;
        }

        const friend = friends.find(item => item.user.id === target.id);
        if (friend) {
          handleContactPress(friendToEnrichedContact(friend));
          return;
        }

        handleContactPress({
          id: target.id,
          name: target.name,
          phone: '',
          userId: target.id,
          avatarUrl: null,
          hasDirectGroup: false,
        });
      },
      [friends, groups, handleContactPress, handleGroupPress]
    );

    // ── Filtered list ─────────────────────────────────────────────────────────

    const listItems = useMemo<ListItem[]>(() => {
      const q = searchQuery.trim().toLowerCase();

      if (showRecentsTier && !q) {
        const items: ListItem[] = [];

        if (recentTargets.length > 0) {
          items.push({ _type: 'sectionHeader', label: 'Recent' });
          recentTargets.forEach(target => items.push({ _type: 'recent', data: target }));
        }

        if (outstandingTargets.length > 0) {
          items.push({ _type: 'sectionHeader', label: 'Outstanding' });
          outstandingTargets.forEach(target => {
            if (target.kind === 'friend') {
              items.push({ _type: 'outstandingFriend', data: target.friend });
            } else {
              items.push({ _type: 'outstandingGroup', data: target.group });
            }
          });
        }

        if (showGroups && groups.length > 0) {
          items.push({ _type: 'sectionHeader', label: 'Groups' });
          groups.forEach(group => items.push({ _type: 'group', data: group }));
        }

        if (contacts.length > 0) {
          items.push({ _type: 'sectionHeader', label: 'Contacts' });
          contacts.forEach(contact => items.push({ _type: 'contact', data: contact }));
        }

        return items;
      }

      const filteredGroups = showGroups
        ? groups.filter(g => !q || g.name.toLowerCase().includes(q))
        : [];

      const filteredContacts = contacts.filter(
        c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)
      );

      const items: ListItem[] = [];

      if (filteredGroups.length > 0) {
        items.push({ _type: 'sectionHeader', label: 'Groups' });
        filteredGroups.forEach(g => items.push({ _type: 'group', data: g }));
      }

      if (filteredContacts.length > 0) {
        if (filteredGroups.length > 0) {
          items.push({ _type: 'sectionHeader', label: 'Contacts' });
        }
        filteredContacts.forEach(c => items.push({ _type: 'contact', data: c }));
      }

      return items;
    }, [
      searchQuery,
      contacts,
      groups,
      showGroups,
      showRecentsTier,
      recentTargets,
      outstandingTargets,
    ]);

    const contactCount = useMemo(
      () => listItems.filter(i => i._type === 'contact').length,
      [listItems]
    );

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleSheetClose = useCallback(() => {
      setSearchQuery('');
      setShouldFocusSearch(false);
      onClose?.();
    }, [onClose]);

    const handleDonePress = useCallback(() => {
      onDone?.();
      (ref as React.RefObject<BottomSheet>)?.current?.close();
    }, [onDone, ref]);

    // ── Row renderers ─────────────────────────────────────────────────────────

    const renderSectionHeader = useCallback(
      (label: string) => (
        <View style={[styles.sectionHeader, { backgroundColor: sheetBg }]}>
          <Text style={[styles.sectionHeaderText, { color: secondaryTextColor }]}>{label}</Text>
        </View>
      ),
      [sheetBg, secondaryTextColor]
    );

    const renderGroupRow = useCallback(
      (group: SearchResultGroup) => (
        <Pressable
          onPress={() => handleGroupPress(group)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <Avatar group={group} size={44} />
          <View style={styles.rowInfo}>
            <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
              {group.name}
            </Text>
            <Text style={[styles.rowMeta, { color: secondaryTextColor }]}>
              {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
        </Pressable>
      ),
      [handleGroupPress, textColor, secondaryTextColor]
    );

    const renderOutstandingFriendRow = useCallback(
      (friend: Friend) => {
        const balance = getBalanceLabel(friend.total_balance);

        return (
          <Pressable
            onPress={() => handleContactPress(friendToEnrichedContact(friend))}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          >
            <Avatar user={friend.user} size={44} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                {friend.user.name}
              </Text>
              <Text style={[styles.rowMeta, { color: balance.color }]}>{balance.text}</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
          </Pressable>
        );
      },
      [handleContactPress, secondaryTextColor, textColor]
    );

    const renderOutstandingGroupRow = useCallback(
      (group: GroupListItem) => {
        const balance = getBalanceLabel(group.your_balance);
        const searchGroup = groupListItemToSearchGroup(group);

        return (
          <Pressable
            onPress={() => handleGroupPress(searchGroup)}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          >
            <Avatar group={searchGroup} size={44} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                {group.name}
              </Text>
              <Text style={[styles.rowMeta, { color: balance.color }]}>{balance.text}</Text>
            </View>
            <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
          </Pressable>
        );
      },
      [handleGroupPress, secondaryTextColor, textColor]
    );

    const renderRecentRow = useCallback(
      (target: RecentExpenseTarget) => (
        <Pressable
          onPress={() => handleRecentPress(target)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <View style={[styles.recentIcon, { backgroundColor: colors.primary[100] }]}>
            <IconSymbol
              name={target.type === 'group' ? 'person.2.fill' : 'person'}
              size={20}
              color={colors.primary[500]}
            />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
              {target.name}
            </Text>
            <Text style={[styles.rowMeta, { color: secondaryTextColor }]}>
              {target.type === 'group' ? 'Group' : 'Friend'}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
        </Pressable>
      ),
      [handleRecentPress, secondaryTextColor, textColor]
    );

    const renderContactRow = useCallback(
      (contact: EnrichedContact) => {
        const isSelected = selectedIds?.has(contact.id) ?? false;
        const isMultiSelect = selectedIds !== undefined;
        const label = contact.phoneLabel
          ? contact.phoneLabel.charAt(0).toUpperCase() + contact.phoneLabel.slice(1).toLowerCase()
          : undefined;

        return (
          <Pressable
            onPress={() => handleContactPress(contact)}
            style={({ pressed }) => [
              styles.row,
              isMultiSelect && isSelected && { backgroundColor: colors.primary[500] + '14' },
              { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Avatar
              user={{ name: contact.name, avatar_url: contact.avatarUrl ?? null }}
              size={44}
            />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                {contact.name}
              </Text>
              <Text style={[styles.rowMeta, { color: secondaryTextColor }]} numberOfLines={1}>
                {contact.phone}
                {label ? ` · ${label}` : ''}
              </Text>
            </View>
            {isMultiSelect && (
              <Checkbox checked={isSelected} />
            )}
          </Pressable>
        );
      },
      [selectedIds, handleContactPress, textColor, secondaryTextColor]
    );

    const renderItem = useCallback(
      ({ item, index }: { item: ListItem; index: number }) => {
        if (item._type === 'sectionHeader') return renderSectionHeader(item.label);
        const delay = Math.min(index * 45, 280);
        let row: ReactNode;
        switch (item._type) {
          case 'group':
            row = renderGroupRow(item.data);
            break;
          case 'outstandingFriend':
            row = renderOutstandingFriendRow(item.data);
            break;
          case 'outstandingGroup':
            row = renderOutstandingGroupRow(item.data);
            break;
          case 'recent':
            row = renderRecentRow(item.data);
            break;
          default:
            row = renderContactRow(item.data);
        }
        return (
          <MotiView
            from={{ opacity: 0, translateX: -14 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220, delay }}
          >
            {row}
          </MotiView>
        );
      },
      [
        renderSectionHeader,
        renderGroupRow,
        renderContactRow,
        renderOutstandingFriendRow,
        renderOutstandingGroupRow,
        renderRecentRow,
      ]
    );

    const keyExtractor = useCallback((item: ListItem, index: number) => {
      if (item._type === 'sectionHeader') return `header-${item.label}-${index}`;
      if (item._type === 'group') return `group-${item.data.id}`;
      if (item._type === 'outstandingFriend') return `outstanding-friend-${item.data.user.id}`;
      if (item._type === 'outstandingGroup') return `outstanding-group-${item.data.id}`;
      if (item._type === 'recent') return `recent-${item.data.type}-${item.data.id}`;
      return `contact-${item.data.id}`;
    }, []);

    const handleSheetIndexChange = useCallback(
      (index: number) => {
        if (index >= 0 && autoFocusSearch) {
          setShouldFocusSearch(true);
        } else {
          setShouldFocusSearch(false);
        }
        onSheetChange?.(index);
      },
      [autoFocusSearch, onSheetChange]
    );

    // ── Render ────────────────────────────────────────────────────────────────

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableOverDrag={false}
        enableDynamicSizing={false}
        backgroundComponent={SheetBackground}
        backgroundStyle={{ backgroundColor: 'transparent' }}
        handleIndicatorStyle={{ backgroundColor: colors.gray[400] }}
        onClose={handleSheetClose}
        onChange={handleSheetIndexChange}
        onAnimate={(fromIndex, toIndex) => {
          if (toIndex === -1) onStartClose?.();
        }}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            { borderBottomColor: isDark ? colors.gray[700] : colors.gray[200] },
          ]}
        >
          <Text style={[styles.headerTitle, { color: textColor }]}>{title}</Text>
          {doneText && (
            <Pressable
              onPress={handleDonePress}
              style={({ pressed }) => [styles.headerDoneButton, { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.93 : 1 }] }]}
            >
              <Text style={[styles.headerDoneText, { color: colors.primary[500] }]}>
                {doneText}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: isDark ? colors.gray[800] : colors.gray[100] },
            ]}
          >
            <IconSymbol name="magnifyingglass" size={20} color={colors.gray[400]} />
            <BottomSheetTextInput
              key={shouldFocusSearch ? 'search-focused' : 'search-idle'}
              autoFocus={shouldFocusSearch}
              placeholder="Search by name or number..."
              placeholderTextColor={colors.gray[400]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { color: textColor }]}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery('')}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.88 : 1 }] })}
              >
                <IconSymbol name="xmark.circle" size={20} color={colors.gray[400]} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Count label */}
        {hasContactPermission && !isLoading && (
          <Text style={[styles.countLabel, { color: secondaryTextColor }]}>
            {searchQuery
              ? `${contactCount} ${contactCount === 1 ? 'result' : 'results'}`
              : showRecentsTier
                ? 'Recent, outstanding, and all contacts'
                : `All Contacts (${contacts.length})`}
          </Text>
        )}

        {/* Permission denied */}
        {hasContactPermission === false && (
          <View style={styles.stateContainer}>
            <IconSymbol name="lock" size={48} color={colors.gray[400]} />
            <Text style={[styles.stateTitle, { color: textColor }]}>
              Contact Access Required
            </Text>
            <Text style={[styles.stateBody, { color: secondaryTextColor }]}>
              To add members, please allow access to your contacts in Settings.
            </Text>
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [
                styles.settingsButton,
                { backgroundColor: colors.primary[500], opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
            >
              <Text style={styles.settingsButtonText}>Open Settings</Text>
            </Pressable>
          </View>
        )}

        {/* Loading */}
        {isLoading && hasContactPermission !== false && (
          <SkeletonContactList count={8} />
        )}

        {/* List */}
        {hasContactPermission && !isLoading && (
          <BottomSheetFlashList
            data={listItems}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={(item: ListItem) => item._type}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <IconSymbol name="person.badge.plus" size={48} color={colors.gray[400]} />
                <Text style={[styles.emptyStateText, { color: secondaryTextColor }]}>
                  {searchQuery ? 'No results found' : 'No contacts available'}
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </BottomSheet>
    );
  }
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  } as ViewStyle,
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    paddingLeft: 44,
  } as TextStyle,
  headerDoneButton: {
    width: 44,
    alignItems: 'flex-end',
  } as ViewStyle,
  headerDoneText: {
    fontSize: 16,
    fontWeight: '600',
  } as TextStyle,
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  } as ViewStyle,
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  } as ViewStyle,
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  } as TextStyle,
  countLabel: {
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 20,
    marginBottom: 12,
  } as TextStyle,
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 6,
  } as ViewStyle,
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  } as TextStyle,
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  } as ViewStyle,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
  } as ViewStyle,
  rowInfo: {
    flex: 1,
  } as ViewStyle,
  rowName: {
    fontSize: 16,
    fontWeight: '500',
  } as TextStyle,
  rowMeta: {
    fontSize: 13,
    marginTop: 2,
  } as TextStyle,
  recentIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  } as ViewStyle,
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  } as TextStyle,
  stateBody: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  } as TextStyle,
  settingsButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
  } as ViewStyle,
  settingsButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  } as TextStyle,
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  } as ViewStyle,
  loadingText: {
    fontSize: 14,
  } as TextStyle,
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  } as ViewStyle,
  emptyStateText: {
    marginTop: 16,
    fontSize: 15,
  } as TextStyle,
});
