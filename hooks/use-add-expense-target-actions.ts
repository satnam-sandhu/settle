import { router } from 'expo-router';
import { useCallback } from 'react';

import type { SearchResultGroup } from '@/hooks/use-contact-group-search';
import type { EnrichedContact } from '@/hooks/use-enriched-contacts';
import { useRecentExpenseTargets } from '@/hooks/use-recent-expense-targets';
import { Analytics } from '@/lib/analytics';
import { ADD_SHEET_EVENTS, type AddSheetEntryPoint } from '@/lib/analytics-events';
import { resolveContactUserId } from '@/lib/add-expense-target';
import { hapticLight } from '@/lib/haptics';
import { showOfflineAlert } from '@/lib/platform-picker';

export function useAddExpenseTargetActions(entryPoint: AddSheetEntryPoint) {
  const { recordRecentTarget } = useRecentExpenseTargets({ enabled: true });

  const handleGroupSelect = useCallback(
    (group: SearchResultGroup) => {
      hapticLight();
      recordRecentTarget({ type: 'group', id: group.id, name: group.name });
      Analytics.track(ADD_SHEET_EVENTS.ADD_SHEET_TARGET_SELECTED, {
        target_type: 'group',
        target_id: group.id,
        entry_point: entryPoint,
      });
      router.push({
        pathname: '/add-expense',
        params: {
          groupId: group.id,
          entry_point: entryPoint === 'friends_empty' ? 'home' : 'tab_plus',
        },
      });
    },
    [entryPoint, recordRecentTarget]
  );

  const handleContactSelect = useCallback(
    async (contact: EnrichedContact) => {
      hapticLight();
      const friendId = await resolveContactUserId(contact);
      if (!friendId) {
        showOfflineAlert('Could not resolve that contact. Please try again.');
        return;
      }

      recordRecentTarget({ type: 'friend', id: friendId, name: contact.name });
      Analytics.track(ADD_SHEET_EVENTS.ADD_SHEET_TARGET_SELECTED, {
        target_type: 'friend',
        target_id: friendId,
        is_existing_user: !!contact.userId,
        entry_point: entryPoint,
      });

      router.push({
        pathname: '/add-expense',
        params: {
          friendId,
          friendName: contact.name,
          entry_point: entryPoint === 'friends_empty' ? 'home' : 'tab_plus',
        },
      });
    },
    [entryPoint, recordRecentTarget]
  );

  return { handleGroupSelect, handleContactSelect, recordRecentTarget };
}
