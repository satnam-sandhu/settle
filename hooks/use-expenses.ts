/**
 * Expenses Hook
 * 
 * Manages expenses for a specific group.
 * Uses TanStack Query for caching and deduplication.
 */

import { useAuth } from '@/contexts/auth-context';
import { useSync } from '@/contexts/sync-context';
import { pendingExpenses, type PendingExpense } from '@/lib/pending-items';
import { queryKeys } from '@/lib/query-client';
import { cache } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { syncQueue } from '@/lib/sync-queue';
import type {
    CurrencyCode,
    DbCategory,
    ExpenseFormData,
    ExpenseListItem,
    GroupedExpenseFormData,
    UserSummary,
} from '@/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 50;

interface ExpensePage {
  items: ExpenseListItem[];
  nextOffset: number | null;
}

async function fetchExpensePage(
  groupId: string,
  userId: string,
  offset: number
): Promise<ExpensePage> {
  const { data: expensesData, error: expensesError } = await supabase
    .from('expenses')
    .select(`
      *,
      paid_by_user:paid_by (id, name, phone, avatar_url),
      category:category_id (*)
    `)
    .eq('group_id', groupId)
    .is('expense_group_id', null)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (expensesError) throw expensesError;

  const rows = expensesData || [];

  // Fetch splits for this page's expenses only
  const expenseIds = rows.map((e) => e.id);
  const splitsMap: Record<string, { user_id: string; amount: number }[]> = {};

  if (expenseIds.length > 0) {
    const { data: splitsData } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, amount')
      .in('expense_id', expenseIds);

    splitsData?.forEach((split) => {
      if (!splitsMap[split.expense_id]) splitsMap[split.expense_id] = [];
      splitsMap[split.expense_id].push(split);
    });
  }

  const items: ExpenseListItem[] = rows.map((e) => {
    const splits = splitsMap[e.id] || [];
    const userSplit = splits.find((s) => s.user_id === userId);

    return {
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
      currency: e.currency as CurrencyCode,
      paid_by: e.paid_by_user as UserSummary,
      category: e.category as DbCategory | null,
      expense_date: e.expense_date,
      created_at: e.created_at,
      your_share: userSplit?.amount || 0,
      you_paid: e.paid_by === userId,
      split_count: splits.length,
    };
  });

  // Cache first page for offline access
  if (offset === 0) await cache.setExpenses(groupId, items);

  return {
    items,
    nextOffset: rows.length === PAGE_SIZE ? offset + PAGE_SIZE : null,
  };
}

async function fetchExpenseGroupsListItems(
  groupId: string,
  userId: string
): Promise<ExpenseGroupListItemWithStatus[]> {
  const { data: groupsData, error: groupsError } = await supabase
    .from('expense_groups')
    .select(`
      id,
      description,
      category_id,
      paid_by,
      created_at,
      paid_by_user:paid_by (id, name, phone, avatar_url),
      category:category_id (*)
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (groupsError) throw groupsError;
  if (!groupsData?.length) return [];

  const groupIds = groupsData.map((g) => g.id);

  const { data: childExpenses, error: childError } = await supabase
    .from('expenses')
    .select('id, expense_group_id, amount, description')
    .in('expense_group_id', groupIds);

  if (childError) throw childError;

  const totalsMap: Record<string, { total: number; count: number }> = {};
  const expenseToGroupId: Record<string, string> = {};
  /** For single-line groups, description to show in list (takes precedence over group description). */
  const firstLineDescriptionMap: Record<string, string> = {};
  (childExpenses || []).forEach((e) => {
    const gid = e.expense_group_id as string;
    if (!totalsMap[gid]) totalsMap[gid] = { total: 0, count: 0 };
    totalsMap[gid].total += Number(e.amount);
    totalsMap[gid].count += 1;
    expenseToGroupId[e.id] = gid;
    if (!firstLineDescriptionMap[gid] && (e as { description?: string }).description) {
      firstLineDescriptionMap[gid] = (e as { description: string }).description;
    }
  });

  const childIds = Object.keys(expenseToGroupId);
  let yourShareMap: Record<string, number> = {};
  if (childIds.length > 0) {
    const { data: splitsData } = await supabase
      .from('expense_splits')
      .select('expense_id, amount')
      .in('expense_id', childIds)
      .eq('user_id', userId);
    (splitsData || []).forEach((s) => {
      const gid = expenseToGroupId[s.expense_id];
      if (gid) yourShareMap[gid] = (yourShareMap[gid] || 0) + Number(s.amount);
    });
  }

  const currency: CurrencyCode = 'INR';
  return groupsData.map((g) => {
    const { total = 0, count = 0 } = totalsMap[g.id] || {};
    const your_share = yourShareMap[g.id] ?? 0;
    const firstLineDesc = firstLineDescriptionMap[g.id];
    return {
      id: g.id,
      description: g.description,
      /** When line_count === 1, use this in list for display (single line takes precedence). */
      first_line_description: firstLineDesc ?? null,
      amount: Math.round(total * 100) / 100,
      currency,
      paid_by: g.paid_by_user as UserSummary,
      category: g.category as DbCategory | null,
      expense_date: g.created_at?.split('T')[0] ?? '',
      created_at: g.created_at,
      your_share,
      you_paid: g.paid_by === userId,
      split_count: count,
      line_count: count,
      isPending: false,
      canEdit: true,
      canDelete: true,
    };
  });
}

// Extended expense item with pending status
export interface ExpenseListItemWithStatus extends ExpenseListItem {
  isPending?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

/** List row shape for an expense_group (one row per grouped expense in the merged list). */
export interface ExpenseGroupListItemWithStatus {
  id: string;
  description: string;
  /** When line_count === 1, show this in list instead of description (single line takes precedence). */
  first_line_description?: string | null;
  amount: number;
  currency: CurrencyCode;
  paid_by: UserSummary;
  category: DbCategory | null;
  expense_date: string;
  created_at: string;
  your_share: number;
  you_paid: boolean;
  /** Number of child expenses (parts); same as line_count for row display. */
  split_count: number;
  /** Number of child expenses (parts). */
  line_count: number;
  isPending?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

/** Discriminated union for the merged group-tab list (standalone expenses + expense_groups). */
export type GroupTabExpenseItem =
  | (ExpenseListItemWithStatus & { itemType: 'expense' })
  | (ExpenseGroupListItemWithStatus & { itemType: 'group' });

interface UseExpensesResult {
  /** Merged list: standalone expenses + expense_groups (one row per payment). */
  expenses: GroupTabExpenseItem[];
  isLoading: boolean;
  /** True while loading additional pages (not the initial load) */
  isFetchingMore: boolean;
  /** Whether there are more expense pages to load from the server */
  hasMoreExpenses: boolean;
  /** Load the next page of 50 expenses */
  loadMoreExpenses: () => void;
  error: string | null;
  createExpense: (data: ExpenseFormData, overrideGroupId?: string) => Promise<string | null>;
  /** Creates a grouped expense (2+ lines). Returns expense_group id. */
  createGroupedExpense: (data: GroupedExpenseFormData, overrideGroupId?: string) => Promise<string | null>;
  /** Updates a grouped expense (replaces all lines). */
  updateGroupedExpense: (expenseGroupId: string, data: GroupedExpenseFormData) => Promise<boolean>;
  /** Converts a grouped expense to a single standalone expense (keeps first part, deletes group). */
  convertGroupedExpenseToSingle: (expenseGroupId: string, data: { description: string; category_id: string | null; paid_by: string; currency: CurrencyCode; expense_date: Date; amount: number; split_between: string[]; notes?: string }) => Promise<string | null>;
  deleteExpense: (expenseId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useExpenses(groupId: string | undefined): UseExpensesResult {
  const { user } = useAuth();
  const { isOnline, canEditItem, refreshPendingItems } = useSync();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [localPendingExpenses, setLocalPendingExpenses] = useState<PendingExpense[]>([]);

  // Load pending expenses for this group
  useEffect(() => {
    if (groupId) {
      pendingExpenses.getByGroup(groupId).then(setLocalPendingExpenses);
    }
  }, [groupId]);

  // Paginated query — pages of 50 expenses, accumulated
  const {
    data: infiniteData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: queryKeys.expenses(groupId || ''),
    queryFn: ({ pageParam = 0 }) => fetchExpensePage(groupId!, user!.id, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    // Grouped-by-default: list only from expense_groups (+ pending). No standalone fetch.
    enabled: false,
    staleTime: 2 * 60 * 1000,
  });

  // Flatten all fetched pages into one list (standalone expenses only)
  const allServerExpenses = useMemo(
    () => infiniteData?.pages.flatMap((p) => p.items) ?? [],
    [infiniteData]
  );

  // Expense groups for this group (one row per grouped expense)
  const { data: expenseGroupsListItems = [] } = useQuery({
    queryKey: queryKeys.expenseGroupsList(groupId || ''),
    queryFn: () => fetchExpenseGroupsListItems(groupId!, user!.id),
    enabled: !!groupId && !!user && isOnline,
    staleTime: 2 * 60 * 1000,
  });

  // Grouped-by-default: list from expense_groups + pending only (no standalone fetch)
  const expenses = useMemo((): GroupTabExpenseItem[] => {
    const groupItems: GroupTabExpenseItem[] = expenseGroupsListItems.map((g) => ({
      ...g,
      canEdit: canEditItem(g.id),
      canDelete: canEditItem(g.id),
      itemType: 'group' as const,
    }));

    const pendingItems: GroupTabExpenseItem[] = localPendingExpenses.map((p) => ({
      id: p.id,
      description: p.description,
      amount: p.amount,
      currency: p.currency,
      paid_by: { id: p.paid_by, name: p.paid_by_name, phone: '', avatar_url: null },
      category: p.category_id ? { id: p.category_id, name: '', icon: p.category_icon || '📦', color: '#C9C9C9', sort_order: 0 } : null,
      expense_date: p.expense_date,
      your_share: p.splits.find(s => s.user_id === user?.id)?.amount || 0,
      you_paid: p.paid_by === user?.id,
      created_at: new Date().toISOString(),
      split_count: p.splits.length,
      isPending: true,
      canEdit: true,
      canDelete: true,
      itemType: 'expense' as const,
    }));

    const merged = [...pendingItems, ...groupItems];
    return merged.sort((a, b) => {
      if (a.isPending && !b.isPending) return -1;
      if (!a.isPending && b.isPending) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [expenseGroupsListItems, localPendingExpenses, user?.id, canEditItem]);

  // Helper to invalidate related queries
  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.expenses(groupId || '') });
    queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroupsList(groupId || '') });
    queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId || '') });
    queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    queryClient.invalidateQueries({ queryKey: queryKeys.recentActivity });
  };

  // Create expense mutation
  const createExpenseMutation = useMutation({
    mutationFn: async ({ formData, overrideGroupId }: { formData: ExpenseFormData; overrideGroupId?: string }): Promise<string> => {
      const effectiveGroupId = overrideGroupId || groupId;
      if (!effectiveGroupId || !user) throw new Error('No group or user');

      const amount = parseFloat(formData.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Calculate splits based on split type
      let splits: { user_id: string; amount: number }[];
      
      if (formData.split_type === 'equal_all') {
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', effectiveGroupId);

        const memberIds = members?.map((m) => m.user_id) || [user.id];
        const splitAmount = amount / memberIds.length;
        
        splits = memberIds.map((userId) => ({
          user_id: userId,
          amount: Math.round(splitAmount * 100) / 100,
        }));
      } else {
        const splitAmount = amount / formData.split_between.length;
        splits = formData.split_between.map((userId) => ({
          user_id: userId,
          amount: Math.round(splitAmount * 100) / 100,
        }));
      }

      // Block offline - screens should prevent this, but guard here too
      if (!isOnline) {
        throw new Error('Adding expenses requires an internet connection');
      }

      const { data: newExpense, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: effectiveGroupId,
          paid_by: formData.paid_by,
          amount,
          currency: formData.currency,
          description: formData.description,
          category_id: formData.category_id,
          notes: formData.notes || null,
          expense_date: formData.expense_date.toISOString().split('T')[0],
          created_by: user.id,
        })
        .select('id')
        .single();

      if (expenseError) throw expenseError;

      const splitsWithExpenseId = splits.map((s) => ({
        ...s,
        expense_id: newExpense.id,
      }));

      const { error: splitsError } = await supabase
        .from('expense_splits')
        .insert(splitsWithExpenseId);

      if (splitsError) throw splitsError;

      return newExpense.id;
    },
    onSuccess: invalidateQueries,
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : 'Failed to create expense');
    },
  });

  // Create grouped expense mutation (1+ lines → expense_group + N expenses via RPC; single-line = 1-line group)
  const createGroupedExpenseMutation = useMutation({
    mutationFn: async ({ formData, overrideGroupId }: { formData: GroupedExpenseFormData; overrideGroupId?: string }): Promise<string> => {
      const effectiveGroupId = overrideGroupId || groupId;
      if (!effectiveGroupId || !user) throw new Error('No group or user');
      if (!formData.lines.length || formData.lines.length < 1) {
        throw new Error('Expense must have at least one line');
      }

      if (!isOnline) {
        throw new Error('Adding expenses requires an internet connection');
      }

      const p_lines = formData.lines.map((line) => ({
        description: line.description.trim(),
        amount: line.amount,
        split_between: line.split_between,
        notes: line.notes?.trim() || undefined,
        paid_by: line.paid_by,
        category_id: line.category_id,
      }));

      const { data: expenseGroupId, error } = await supabase.rpc('create_grouped_expense', {
        p_group_id: effectiveGroupId,
        p_description: formData.description.trim(),
        p_category_id: formData.category_id,
        p_paid_by: formData.paid_by,
        p_currency: formData.currency,
        p_expense_date: formData.expense_date.toISOString().split('T')[0],
        p_lines,
      });

      if (error) throw error;
      if (!expenseGroupId) throw new Error('No expense group id returned');

      return expenseGroupId as string;
    },
    onSuccess: invalidateQueries,
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : 'Failed to create grouped expense');
    },
  });

  // Update grouped expense mutation
  const updateGroupedExpenseMutation = useMutation({
    mutationFn: async ({ expenseGroupId, formData }: { expenseGroupId: string; formData: GroupedExpenseFormData }): Promise<void> => {
      if (!formData.lines.length || formData.lines.length < 1) {
        throw new Error('Grouped expense requires at least 1 line');
      }
      const p_lines = formData.lines.map((line) => ({
        description: line.description.trim(),
        amount: line.amount,
        split_between: line.split_between,
        notes: line.notes?.trim() || undefined,
        paid_by: line.paid_by,
        category_id: line.category_id,
      }));
      const { error } = await supabase.rpc('update_grouped_expense', {
        p_expense_group_id: expenseGroupId,
        p_description: formData.description.trim(),
        p_category_id: formData.category_id,
        p_paid_by: formData.paid_by,
        p_currency: formData.currency,
        p_expense_date: formData.expense_date.toISOString().split('T')[0],
        p_lines,
      });
      if (error) throw error;
    },
    onSuccess: (_, { expenseGroupId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroup(expenseGroupId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroupsList(groupId || '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses(groupId || '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.recentActivity });
    },
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : 'Failed to update grouped expense');
    },
  });

  // Convert grouped expense to single (when user edits and removes to 1 part)
  const convertGroupedExpenseToSingleMutation = useMutation({
    mutationFn: async ({
      expenseGroupId,
      data: formData,
    }: {
      expenseGroupId: string;
      data: { description: string; category_id: string | null; paid_by: string; currency: CurrencyCode; expense_date: Date; amount: number; split_between: string[]; notes?: string };
    }): Promise<string> => {
      const { data: expenseId, error } = await supabase.rpc('convert_grouped_expense_to_single', {
        p_expense_group_id: expenseGroupId,
        p_description: formData.description.trim(),
        p_category_id: formData.category_id,
        p_paid_by: formData.paid_by,
        p_currency: formData.currency,
        p_expense_date: formData.expense_date.toISOString().split('T')[0],
        p_amount: formData.amount,
        p_split_between: formData.split_between,
        p_notes: formData.notes?.trim() || null,
      });
      if (error) throw error;
      if (!expenseId) throw new Error('No expense id returned');
      return expenseId as string;
    },
    onSuccess: (_, { expenseGroupId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroup(expenseGroupId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroupsList(groupId || '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses(groupId || '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.recentActivity });
    },
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : 'Failed to convert to single expense');
    },
  });

  // Delete expense mutation
  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const isPending = expenseId.startsWith('pending_');

      if (isPending) {
        // Delete pending expense locally
        const pendingExpense = await pendingExpenses.get(expenseId);
        if (pendingExpense) {
          // Remove from sync queue
          await syncQueue.remove(pendingExpense.syncActionId);
          // Remove from pending storage
          await pendingExpenses.remove(expenseId);
          setLocalPendingExpenses((prev) => prev.filter((e) => e.id !== expenseId));
          await refreshPendingItems();
        }
      } else if (isOnline) {
        const { error: deleteError } = await supabase
          .from('expenses')
          .delete()
          .eq('id', expenseId);

        if (deleteError) throw deleteError;
      } else {
        // Can't delete synced items while offline
        throw new Error('Cannot delete synced items while offline');
      }
    },
    onSuccess: invalidateQueries,
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : 'Failed to delete expense');
    },
  });

  const createExpense = async (formData: ExpenseFormData, overrideGroupId?: string): Promise<string | null> => {
    setMutationError(null);
    try {
      return await createExpenseMutation.mutateAsync({ formData, overrideGroupId });
    } catch {
      return null;
    }
  };

  const createGroupedExpense = async (formData: GroupedExpenseFormData, overrideGroupId?: string): Promise<string | null> => {
    setMutationError(null);
    try {
      return await createGroupedExpenseMutation.mutateAsync({ formData, overrideGroupId });
    } catch {
      return null;
    }
  };

  const updateGroupedExpense = async (expenseGroupId: string, formData: GroupedExpenseFormData): Promise<boolean> => {
    setMutationError(null);
    try {
      await updateGroupedExpenseMutation.mutateAsync({ expenseGroupId, formData });
      return true;
    } catch {
      return false;
    }
  };

  const convertGroupedExpenseToSingle = async (
    expenseGroupId: string,
    data: { description: string; category_id: string | null; paid_by: string; currency: CurrencyCode; expense_date: Date; amount: number; split_between: string[]; notes?: string }
  ): Promise<string | null> => {
    setMutationError(null);
    try {
      return await convertGroupedExpenseToSingleMutation.mutateAsync({ expenseGroupId, data });
    } catch {
      return null;
    }
  };

  const deleteExpense = async (expenseId: string): Promise<boolean> => {
    setMutationError(null);
    try {
      await deleteExpenseMutation.mutateAsync(expenseId);
      return true;
    } catch {
      return false;
    }
  };

  const refresh = async () => {
    await refetch();
  };

  return {
    expenses,
    isLoading: isLoading && localPendingExpenses.length === 0,
    isFetchingMore: isFetchingNextPage,
    hasMoreExpenses: hasNextPage ?? false,
    loadMoreExpenses: fetchNextPage,
    error: error ? (error instanceof Error ? error.message : 'Failed to fetch expenses') : mutationError,
    createExpense,
    createGroupedExpense,
    updateGroupedExpense,
    convertGroupedExpenseToSingle,
    deleteExpense,
    refresh,
  };
}
