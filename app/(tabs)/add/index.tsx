/**
 * Add tab — stay on this screen to search, then pick a person/group for add-expense.
 * iOS: nested stack + headerSearchBarOptions integrates with NativeTabs role="search".
 * Android: inline search field (role="search" is iOS-only).
 */

import { Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { PeopleSearchPanel } from '@/components/people-search-panel';
import { colors } from '@/constants/colors';
import { useAddExpenseTargetActions } from '@/hooks/use-add-expense-target-actions';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarOffset } from '@/hooks/use-tab-bar-offset';

const useInlineSearch = Platform.OS !== 'ios';

export default function AddSearchTabScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { contentPaddingBottom } = useTabBarOffset();
  const [searchQuery, setSearchQuery] = useState('');
  const { handleGroupSelect, handleContactSelect, recordRecentTarget } =
    useAddExpenseTargetActions('tab_plus');

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? colors.background.dark : colors.background.light,
      }}
    >
      <Stack.Screen
        options={{
          headerShown: false,
          ...(useInlineSearch
            ? {}
            : {
                headerSearchBarOptions: {
                  placeholder: 'Search people and groups',
                  hideWhenScrolling: false,
                  onChangeText: event => setSearchQuery(event.nativeEvent.text),
                  onCancelButtonPress: () => setSearchQuery(''),
                },
              }),
        }}
      />
      <PeopleSearchPanel
        searchQuery={searchQuery}
        onSearchQueryChange={useInlineSearch ? setSearchQuery : undefined}
        autoFocusSearch={useInlineSearch}
        onGroupSelect={handleGroupSelect}
        onContactSelect={handleContactSelect}
        recordRecentTarget={recordRecentTarget}
        listPaddingBottom={contentPaddingBottom}
      />
    </View>
  );
}
