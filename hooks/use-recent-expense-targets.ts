/**
 * Recents tiering for the global add-expense sheet.
 *
 * Tier 1 — outstanding friends/groups (from useFriends + useGroups)
 * Tier 2 — persisted recent selections (AsyncStorage)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useFriends } from '@/hooks/use-friends';
import { useGroups } from '@/hooks/use-groups';
import { cache } from '@/lib/storage';
import type { Friend, GroupListItem } from '@/types';

export const MAX_RECENT_EXPENSE_TARGETS = 8;
export const MAX_OUTSTANDING_TARGETS = 8;

export type RecentExpenseTargetType = 'friend' | 'group';

export interface RecentExpenseTarget {
  type: RecentExpenseTargetType;
  id: string;
  name: string;
  timestamp: number;
}

export interface OutstandingGroupTarget {
  kind: 'group';
  balance: number;
  group: GroupListItem;
}

export interface OutstandingFriendTarget {
  kind: 'friend';
  balance: number;
  friend: Friend;
}

export type OutstandingTarget = OutstandingFriendTarget | OutstandingGroupTarget;

interface UseRecentExpenseTargetsOptions {
  enabled?: boolean;
}

export function useRecentExpenseTargets(options: UseRecentExpenseTargetsOptions = {}) {
  const enabled = options.enabled ?? true;
  const { friends } = useFriends();
  const { groups } = useGroups();
  const [recentTargets, setRecentTargets] = useState<RecentExpenseTarget[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    cache.getRecentExpenseTargets<RecentExpenseTarget>().then(stored => {
      if (!cancelled) setRecentTargets(stored);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const recordRecentTarget = useCallback(
    async (target: Pick<RecentExpenseTarget, 'type' | 'id' | 'name'>) => {
      if (!enabled) return;

      const entry: RecentExpenseTarget = {
        ...target,
        timestamp: Date.now(),
      };

      setRecentTargets(current => {
        const deduped = current.filter(
          item => !(item.type === entry.type && item.id === entry.id)
        );
        const next = [entry, ...deduped].slice(0, MAX_RECENT_EXPENSE_TARGETS);
        void cache.setRecentExpenseTargets(next);
        return next;
      });
    },
    [enabled]
  );

  const outstandingFriends = useMemo(() => {
    if (!enabled) return [] as Friend[];

    return friends
      .filter(friend => friend.total_balance !== 0)
      .sort((a, b) => Math.abs(b.total_balance) - Math.abs(a.total_balance));
  }, [enabled, friends]);

  const outstandingGroups = useMemo(() => {
    if (!enabled) return [] as GroupListItem[];

    return groups
      .filter(group => group.your_balance !== 0)
      .sort((a, b) => Math.abs(b.your_balance) - Math.abs(a.your_balance));
  }, [enabled, groups]);

  const outstandingTargets = useMemo<OutstandingTarget[]>(() => {
    if (!enabled) return [];

    const combined: OutstandingTarget[] = [
      ...outstandingFriends.map(friend => ({
        kind: 'friend' as const,
        balance: friend.total_balance,
        friend,
      })),
      ...outstandingGroups.map(group => ({
        kind: 'group' as const,
        balance: group.your_balance,
        group,
      })),
    ];

    return combined
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
      .slice(0, MAX_OUTSTANDING_TARGETS);
  }, [enabled, outstandingFriends, outstandingGroups]);

  const visibleRecentTargets = useMemo(() => {
    if (!enabled) return [] as RecentExpenseTarget[];
    return recentTargets.slice(0, MAX_RECENT_EXPENSE_TARGETS);
  }, [enabled, recentTargets]);

  return {
    recentTargets: visibleRecentTargets,
    outstandingTargets,
    recordRecentTarget,
  };
}
