/**
 * Single Expense Group Hook
 *
 * Fetches an expense_group with its child expenses and splits for the grouped-expense detail view.
 * Exposes canEdit (group member + online) and deleteExpenseGroup.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useSync } from '@/contexts/sync-context';
import { useGroup } from '@/hooks/use-group';
import { queryKeys } from '@/lib/query-client';
import type {
  CurrencyCode,
  DbCategory,
  ExpenseGroup,
  ExpenseGroupWithLines,
  ExpenseSplitInfo,
  GroupedExpenseLine,
  UserSummary,
} from '@/types';

async function fetchExpenseGroupData(expenseGroupId: string): Promise<ExpenseGroupWithLines> {
  const { data: groupData, error: groupError } = await supabase
    .from('expense_groups')
    .select(`
      *,
      paid_by_user:paid_by (id, name, phone, avatar_url),
      category:category_id (*)
    `)
    .eq('id', expenseGroupId)
    .single();

  if (groupError) throw groupError;

  const groupDataTyped = groupData as {
    id: string;
    group_id: string;
    description: string;
    category_id: string | null;
    paid_by: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    paid_by_user: unknown;
    category: unknown;
  } | null;

  if (!groupDataTyped) throw new Error('Expense group not found');

  const { data: childExpensesRaw, error: childrenError } = await supabase
    .from('expenses')
    .select(`
      id,
      description,
      amount,
      currency,
      expense_group_id,
      notes,
      paid_by,
      category_id,
      paid_by_user:paid_by (id, name, phone, avatar_url),
      category:category_id (*)
    `)
    .eq('expense_group_id', expenseGroupId)
    .order('created_at', { ascending: true });

  if (childrenError) throw childrenError;

  const childExpenses = (childExpensesRaw || []) as Array<{
    id: string;
    description: string;
    amount: number;
    currency: string;
    expense_group_id: string;
    notes: string | null;
    paid_by: string;
    category_id: string | null;
    paid_by_user: unknown;
    category: unknown;
  }>;

  const expenseIds = childExpenses.map((e) => e.id);
  let splitsMap: Record<string, ExpenseSplitInfo[]> = {};

  if (expenseIds.length > 0) {
    const { data: splitsData, error: splitsError } = await supabase
      .from('expense_splits')
      .select(`
        expense_id,
        user_id,
        amount,
        user:user_id (id, name, phone, avatar_url)
      `)
      .in('expense_id', expenseIds);

    if (splitsError) throw splitsError;

    (splitsData || []).forEach((s) => {
      const row = s as {
        expense_id: string;
        user_id: string;
        amount: number;
        user: unknown;
      };
      if (!splitsMap[row.expense_id]) splitsMap[row.expense_id] = [];
      splitsMap[row.expense_id].push({
        user_id: row.user_id,
        amount: Number(row.amount),
        user: row.user as UserSummary,
      });
    });
  }

  const lines: GroupedExpenseLine[] = childExpenses.map((e) => ({
    id: e.id,
    description: e.description,
    amount: Number(e.amount),
    currency: e.currency as CurrencyCode,
    splits: splitsMap[e.id] || [],
    notes: e.notes ?? undefined,
    paid_by: e.paid_by,
    paid_by_user: e.paid_by_user as UserSummary,
    category_id: e.category_id,
    category: (e.category as DbCategory | null) ?? null,
  }));

  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  const group: ExpenseGroup = {
    id: groupDataTyped.id,
    group_id: groupDataTyped.group_id,
    description: groupDataTyped.description,
    category_id: groupDataTyped.category_id,
    category: groupDataTyped.category as DbCategory | null,
    paid_by: groupDataTyped.paid_by,
    paid_by_user: groupDataTyped.paid_by_user as UserSummary,
    created_by: groupDataTyped.created_by,
    created_at: groupDataTyped.created_at,
    updated_at: groupDataTyped.updated_at,
    total,
    line_count: lines.length,
  };

  return { group, lines };
}

export interface UseExpenseGroupResult {
  expenseGroup: ExpenseGroupWithLines | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  canEdit: boolean;
  deleteExpenseGroup: () => Promise<boolean>;
}

export function useExpenseGroup(expenseGroupId: string | undefined): UseExpenseGroupResult {
  const { user } = useAuth();
  const { isOnline } = useSync();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.expenseGroup(expenseGroupId || ''),
    queryFn: () => fetchExpenseGroupData(expenseGroupId!),
    enabled: !!expenseGroupId && !!user,
    staleTime: 2 * 60 * 1000,
  });

  const { group } = useGroup(data?.group?.group_id);
  const isInGroup = !!group?.members?.some((m) => m.user_id === user?.id);
  const canEdit = !!data && isOnline && isInGroup;

  const deleteMutation = useMutation({
    mutationFn: async (groupId: string | undefined) => {
      if (!expenseGroupId) throw new Error('No expense group id');
      const { error: deleteError } = await supabase
        .from('expense_groups')
        .delete()
        .eq('id', expenseGroupId);
      if (deleteError) throw deleteError;
      return groupId;
    },
    onSuccess: (groupId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroup(expenseGroupId!) });
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.expenseGroupsList(groupId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses(groupId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.recentActivity });
    },
  });

  const deleteExpenseGroup = async (): Promise<boolean> => {
    if (!expenseGroupId) return false;
    const groupId = data?.group?.group_id;
    try {
      await deleteMutation.mutateAsync(groupId);
      return true;
    } catch {
      return false;
    }
  };

  const refresh = async () => {
    await refetch();
  };

  return {
    expenseGroup: data ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to fetch grouped expense') : null,
    refresh,
    canEdit,
    deleteExpenseGroup,
  };
}
