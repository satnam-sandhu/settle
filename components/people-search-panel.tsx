/**
 * Full-screen people/group search list — used on the Add tab.
 * Shares tiering and row UI with PeopleSearchSheet.
 */

import { FlashList } from '@shopify/flash-list';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
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
import { useRecentExpenseTargets } from '@/hooks/use-recent-expense-targets';
import { formatCurrency } from '@/lib/utils';
import type { Friend, GroupListItem } from '@/types';

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
    return { text: `you get back ${formatCurrency(balance)}`, color: colors.success };
  }
  return { text: `you owe ${formatCurrency(Math.abs(balance))}`, color: colors.error };
}

export interface PeopleSearchPanelProps {
  searchQuery: string;
  onSearchQueryChange?: (query: string) => void;
  autoFocusSearch?: boolean;
  onContactSelect: (contact: EnrichedContact) => void;
  onGroupSelect: (group: SearchResultGroup) => void;
  recordRecentTarget?: (target: Pick<RecentExpenseTarget, 'type' | 'id' | 'name'>) => void;
  listPaddingBottom?: number;
}

export function PeopleSearchPanel({
  searchQuery,
  onSearchQueryChange,
  autoFocusSearch = false,
  onContactSelect,
  onGroupSelect,
  recordRecentTarget,
  listPaddingBottom = 24,
}: PeopleSearchPanelProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;

  const { contacts, groups, isLoading, hasContactPermission, loadInitialData } =
    useEnrichedContacts();
  const { friends } = useFriends();
  const { recentTargets, outstandingTargets } = useRecentExpenseTargets({ enabled: true });

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleGroupPress = useCallback(
    (group: SearchResultGroup) => {
      recordRecentTarget?.({ type: 'group', id: group.id, name: group.name });
      onGroupSelect(group);
    },
    [onGroupSelect, recordRecentTarget]
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

  const listItems = useMemo<ListItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();

    if (!q) {
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

      if (groups.length > 0) {
        items.push({ _type: 'sectionHeader', label: 'Groups' });
        groups.forEach(group => items.push({ _type: 'group', data: group }));
      }

      if (contacts.length > 0) {
        items.push({ _type: 'sectionHeader', label: 'Contacts' });
        contacts.forEach(contact => items.push({ _type: 'contact', data: contact }));
      }

      return items;
    }

    const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(q));
    const filteredContacts = contacts.filter(
      c => c.name.toLowerCase().includes(q) || c.phone.includes(q)
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
  }, [searchQuery, contacts, groups, recentTargets, outstandingTargets]);

  const renderSectionHeader = useCallback(
    (label: string) => (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionHeaderText, { color: secondaryTextColor }]}>{label}</Text>
      </View>
    ),
    [secondaryTextColor]
  );

  const renderGroupRow = useCallback(
    (group: SearchResultGroup) => (
      <Pressable
        onPress={() => handleGroupPress(group)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
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
    [handleGroupPress, secondaryTextColor, textColor]
  );

  const renderContactRow = useCallback(
    (contact: EnrichedContact) => (
      <Pressable
        onPress={() => handleContactPress(contact)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Avatar user={{ name: contact.name, avatar_url: contact.avatarUrl ?? null }} size={44} />
        <View style={styles.rowInfo}>
          <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
            {contact.name}
          </Text>
          <Text style={[styles.rowMeta, { color: secondaryTextColor }]} numberOfLines={1}>
            {contact.phone}
          </Text>
        </View>
        <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
      </Pressable>
    ),
    [handleContactPress, secondaryTextColor, textColor]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ListItem; index: number }) => {
      if (item._type === 'sectionHeader') return renderSectionHeader(item.label);

      let row: ReactNode;
      switch (item._type) {
        case 'group':
          row = renderGroupRow(item.data);
          break;
        case 'outstandingFriend': {
          const balance = getBalanceLabel(item.data.total_balance);
          row = (
            <Pressable
              onPress={() => handleContactPress(friendToEnrichedContact(item.data))}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Avatar user={item.data.user} size={44} />
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                  {item.data.user.name}
                </Text>
                <Text style={[styles.rowMeta, { color: balance.color }]}>{balance.text}</Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>
          );
          break;
        }
        case 'outstandingGroup': {
          const balance = getBalanceLabel(item.data.your_balance);
          const searchGroup = groupListItemToSearchGroup(item.data);
          row = (
            <Pressable
              onPress={() => handleGroupPress(searchGroup)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Avatar group={searchGroup} size={44} />
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                  {item.data.name}
                </Text>
                <Text style={[styles.rowMeta, { color: balance.color }]}>{balance.text}</Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>
          );
          break;
        }
        case 'recent':
          row = (
            <Pressable
              onPress={() => handleRecentPress(item.data)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
            >
              <View style={[styles.recentIcon, { backgroundColor: colors.primary[100] }]}>
                <IconSymbol
                  name={item.data.type === 'group' ? 'person.2.fill' : 'person'}
                  size={20}
                  color={colors.primary[500]}
                />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                  {item.data.name}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>
          );
          break;
        default:
          row = renderContactRow(item.data);
      }

      return (
        <MotiView
          from={{ opacity: 0, translateX: -10 }}
          animate={{ opacity: 1, translateX: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 220, delay: Math.min(index * 40, 240) }}
        >
          {row}
        </MotiView>
      );
    },
    [
      handleRecentPress,
      renderContactRow,
      renderGroupRow,
      renderSectionHeader,
      secondaryTextColor,
      textColor,
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

  if (!hasContactPermission && !isLoading) {
    return (
      <View style={[styles.stateContainer, { backgroundColor }]}>
        <IconSymbol name="person.crop.circle.badge.exclamationmark" size={48} color={colors.gray[400]} />
        <Text style={[styles.stateTitle, { color: textColor }]}>Contacts access needed</Text>
        <Text style={[styles.stateBody, { color: secondaryTextColor }]}>
          Allow contact access in Settings to add expenses with your contacts.
        </Text>
        <Pressable
          onPress={() => Linking.openSettings()}
          style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  const searchField = onSearchQueryChange ? (
    <View style={[styles.searchContainer, { paddingTop: insets.top + 8 }]}>
      <View
        style={[
          styles.searchBox,
          { backgroundColor: isDark ? colors.gray[800] : colors.gray[100] },
        ]}
      >
        <IconSymbol name="magnifyingglass" size={20} color={colors.gray[400]} />
        <TextInput
          autoFocus={autoFocusSearch}
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="Search people and groups"
          placeholderTextColor={colors.gray[400]}
          value={searchQuery}
          onChangeText={onSearchQueryChange}
          style={[styles.searchInput, { color: textColor }]}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => onSearchQueryChange('')}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            hitSlop={8}
          >
            <IconSymbol name="xmark.circle" size={20} color={colors.gray[400]} />
          </Pressable>
        )}
      </View>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {searchField}
      {isLoading ? (
        <SkeletonContactList count={6} />
      ) : (
        <FlashList
          data={listItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          estimatedItemSize={64}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <IconSymbol name="person.badge.plus" size={48} color={colors.gray[400]} />
              <Text style={[styles.emptyText, { color: secondaryTextColor }]}>
                {searchQuery ? 'No results found' : 'No contacts available'}
              </Text>
            </View>
          }
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: listPaddingBottom,
            paddingTop: onSearchQueryChange ? 0 : insets.top,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  sectionHeader: { paddingVertical: 6 },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  recentIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 15, marginTop: 12, textAlign: 'center' },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  stateTitle: { fontSize: 18, fontWeight: '600', marginTop: 16, textAlign: 'center' },
  stateBody: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  settingsButton: {
    marginTop: 20,
    backgroundColor: colors.primary[500],
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  settingsButtonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
});
