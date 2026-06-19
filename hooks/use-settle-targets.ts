/**
 * Shared settle-target filtering for SettlePickerSheet and settle-up search.
 */

import { useMemo } from 'react';

import type { CurrencyCode, Friend, UserSummary } from '@/types';

export interface SettleTarget {
  user: UserSummary;
  balance: number;
  currency: CurrencyCode;
}

export function friendToSettleTarget(friend: Friend): SettleTarget {
  return {
    user: friend.user,
    balance: friend.total_balance,
    currency: friend.primary_currency,
  };
}

export function sortSettleTargetsByAbsBalance(targets: SettleTarget[]): SettleTarget[] {
  return [...targets].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

export function filterSettleTargetsBySearch(
  targets: SettleTarget[],
  searchQuery: string
): SettleTarget[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return targets;
  return targets.filter(target => target.user.name.toLowerCase().includes(query));
}

export function getSettleTargetsFromFriends(friends: Friend[]): SettleTarget[] {
  return sortSettleTargetsByAbsBalance(
    friends.filter(friend => friend.total_balance !== 0).map(friendToSettleTarget)
  );
}

export function partitionSettleTargets(targets: SettleTarget[]): {
  youOwe: SettleTarget[];
  youGetBack: SettleTarget[];
} {
  const youOwe = targets
    .filter(target => target.balance < 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const youGetBack = targets
    .filter(target => target.balance > 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return { youOwe, youGetBack };
}

export function useSettleTargets(friends: Friend[], searchQuery: string) {
  return useMemo(() => {
    const targets = filterSettleTargetsBySearch(getSettleTargetsFromFriends(friends), searchQuery);
    return partitionSettleTargets(targets);
  }, [friends, searchQuery]);
}
