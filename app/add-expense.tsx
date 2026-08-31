/**
 * Add / Edit Expense Screen
 *
 * Modes:
 * - groupId provided:            Add expense to an existing group
 * - friendId + friendName:       Add expense with a friend (1:1)
 * - No params:                   Search mode — sheet opens automatically
 * - expenseId + groupId params:  Edit single expense — pre-fills, updateExpense on submit
 * - expenseGroupId + groupId:    Edit grouped expense — pre-fills all lines, updateGroupedExpense on submit
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeopleSearchSheet } from '@/components/people-search-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SheetBackground } from '@/components/ui/sheet-background';
import { Input } from '@/components/ui/input';
import { colors } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useSync } from '@/contexts/sync-context';
import { useCategories } from '@/hooks/use-categories';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SearchResultGroup } from '@/hooks/use-contact-group-search';
import { useDirectGroup } from '@/hooks/use-direct-group';
import type { EnrichedContact } from '@/hooks/use-enriched-contacts';
import { normalizePhone } from '@/hooks/use-enriched-contacts';
import { useExpense } from '@/hooks/use-expense';
import { useExpenseGroup } from '@/hooks/use-expense-group';
import { useExpenses } from '@/hooks/use-expenses';
import { useGroup } from '@/hooks/use-group';
import { Analytics } from '@/lib/analytics';
import { EXPENSE_EVENTS, type AddExpenseEntryPoint } from '@/lib/analytics-events';
import { hapticHeavy, hapticSelection, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { HeaderSaveButton, NativeScreenHeader } from '@/lib/native-header';
import { showPlatformAlert } from '@/lib/platform-picker';
import { supabase } from '@/lib/supabase';
import type { CurrencyCode, DbCategory, ExpenseFormData, GroupedExpenseFormData, GroupMember, SplitType } from '@/types';
import { CURRENCIES } from '@/types/database';

function resolveAddExpenseEntryPoint(params: {
  entry_point?: string;
  groupId?: string;
  friendId?: string;
}): AddExpenseEntryPoint {
  if (params.entry_point === 'tab_plus') return 'tab_plus';
  if (params.groupId) return 'group';
  if (params.friendId) return 'friend';
  return 'home';
}

type ExtraLineDraft = {
  description: string;
  amount: string;
  splitBetween: string[];
  notes: string;
  paidBy: string;
  category: DbCategory | null;
};

type PickerLineTarget = 'main' | number;

function toGroupedLineForm(
  description: string,
  amount: string,
  splitBetween: string[],
  notes: string,
  paidBy: string,
  category: DbCategory | null
): GroupedExpenseFormData['lines'][number] {
  return {
    description: description.trim(),
    amount: parseFloat(amount),
    split_between: splitBetween,
    notes: notes.trim() || undefined,
    paid_by: paidBy,
    category_id: category?.id || null,
  };
}

export default function AddExpenseScreen() {
  const params = useLocalSearchParams<{
    groupId?: string;
    friendId?: string;
    friendName?: string;
    entry_point?: string;
    expenseId?: string;
    expenseGroupId?: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const { isOnline } = useSync();

  // Edit mode: single expense or grouped expense
  const isEditMode = !!params.expenseId || !!params.expenseGroupId;
  const isEditModeGrouped = !!params.expenseGroupId;
  const screenTitle = isEditMode ? 'Edit Expense' : 'Add Expense';
  const { expense: existingExpense, updateExpense } = useExpense(params.expenseId);
  const { expenseGroup, isLoading: isLoadingExpenseGroup } = useExpenseGroup(params.expenseGroupId);

  // Determine creation mode
  const hasPreselection = !!params.groupId || !!params.friendId;
  const isDirectExpense = !!params.friendId && !params.groupId;
  const isSearchMode = !hasPreselection && !isEditMode;

  const [resolvedGroupId, setResolvedGroupId] = useState<string | undefined>(params.groupId);
  const [selectedFriendId, setSelectedFriendId] = useState<string | undefined>(params.friendId);
  const [selectedFriendName, setSelectedFriendName] = useState<string | undefined>(params.friendName);
  const [selectedFriendPhone, setSelectedFriendPhone] = useState<string | undefined>();

  const { group, isLoading: isLoadingGroup } = useGroup(resolvedGroupId);
  const { categories } = useCategories();
  const { createGroupedExpense, updateGroupedExpense } = useExpenses(resolvedGroupId);
  const { findOrCreateDirectGroup, isLoading: isCreatingDirectGroup } = useDirectGroup();

  // Block offline in create mode
  useEffect(() => {
    if (!isOnline && !isEditMode) {
      showPlatformAlert(
        'No Connection',
        'Adding expenses requires an internet connection.',
        'OK',
        () => router.back(),
      );
    }
  }, [isOnline, isEditMode]);

  // Analytics
  useEffect(() => {
    if (isEditMode) return;
    const entryPoint = resolveAddExpenseEntryPoint(params);
    Analytics.trackScreen('add_expense', { entry_point: entryPoint });
    Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_STARTED, {
      entry_point: entryPoint,
      has_preselection: hasPreselection,
      is_direct_expense: isDirectExpense,
    });
  }, []);

  // Search / target state
  const [hasSelectedTarget, setHasSelectedTarget] = useState(hasPreselection || isEditMode);
  const [isCreatingShadowUser, setIsCreatingShadowUser] = useState(false);

  // Bottom sheet
  const bottomSheetRef = useRef<BottomSheet>(null);
  const hasSelectedTargetRef = useRef(hasPreselection || isEditMode);
  useEffect(() => { hasSelectedTargetRef.current = hasSelectedTarget; }, [hasSelectedTarget]);

  // Expand search sheet when visible (initial open + after clearing selection).
  // PeopleSearchSheet is only mounted while `!hasSelectedTarget` so a closed BottomSheet
  // (index -1) never sits on top of the form on Android (touch-blocking bug).
  useEffect(() => {
    if (!isSearchMode || hasSelectedTarget) return;
    const timer = setTimeout(() => bottomSheetRef.current?.expand(), 150);
    return () => clearTimeout(timer);
  }, [isSearchMode, hasSelectedTarget]);

  // Form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [selectedCategory, setSelectedCategory] = useState<DbCategory | null>(null);
  const [paidBy, setPaidBy] = useState<string>('');
  const [splitType] = useState<SplitType>('equal_selected');
  const [splitBetween, setSplitBetween] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasPrefilledFromExpense, setHasPrefilledFromExpense] = useState(false);
  const [hasPrefilledFromGroup, setHasPrefilledFromGroup] = useState(false);

  // Grouped expense: parent description (top-level when 2+ parts); description = Part 1 only when grouped
  const [groupDescription, setGroupDescription] = useState('');
  // Grouped expense: additional lines (when length >= 1 we create a grouped expense)
  const [extraLines, setExtraLines] = useState<ExtraLineDraft[]>([]);

  // Picker sheet state — mount BottomSheet only while open or opening; unmount when closed
  // so index=-1 never blocks touches on Android (@gorhom/bottom-sheet).
  const pickerSheetRef = useRef<BottomSheet>(null);
  const [activeSheet, setActiveSheet] = useState<'currency' | 'category' | 'paidBy' | null>(null);
  const [pickerSheetMounted, setPickerSheetMounted] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // Theme
  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;
  const borderColor = isDark ? colors.gray[700] : colors.gray[200];

  // Pre-fill from existing single expense when editing
  useEffect(() => {
    if (!params.expenseId || !existingExpense || hasPrefilledFromExpense) return;
    setAmount(existingExpense.amount.toString());
    setDescription(existingExpense.description);
    setSelectedCategory(existingExpense.category);
    setNotes(existingExpense.notes || '');
    setPaidBy(existingExpense.paid_by);
    setSplitBetween(existingExpense.splits.map((s) => s.user_id));
    setCurrency(existingExpense.currency);
    setHasPrefilledFromExpense(true);
  }, [params.expenseId, existingExpense, hasPrefilledFromExpense]);

  // Pre-fill from grouped expense when editing (parent description = eg.description, Part 1 = lines[0].description)
  useEffect(() => {
    if (!isEditModeGrouped || !expenseGroup || hasPrefilledFromGroup) return;
    const { group: eg, lines } = expenseGroup;
    setGroupDescription(eg.description);
    setCurrency((lines[0]?.currency ?? 'INR') as CurrencyCode);
    if (lines.length > 0) {
      setDescription(lines[0].description);
      setAmount(lines[0].amount.toString());
      setSplitBetween(lines[0].splits.map((s) => s.user_id));
      setNotes(lines[0].notes ?? '');
      setPaidBy(lines[0].paid_by ?? eg.paid_by);
      setSelectedCategory(lines[0].category ?? eg.category);
      if (lines.length > 1) {
        setExtraLines(
          lines.slice(1).map((l) => ({
            description: l.description,
            amount: l.amount.toString(),
            splitBetween: l.splits.map((s) => s.user_id),
            notes: l.notes ?? '',
            paidBy: l.paid_by ?? eg.paid_by,
            category: l.category ?? null,
          }))
        );
      }
    } else {
      setPaidBy(eg.paid_by);
      setSelectedCategory(eg.category);
    }
    setHasPrefilledFromGroup(true);
  }, [isEditModeGrouped, expenseGroup, hasPrefilledFromGroup]);

  // Group selected from sheet
  const handleSelectGroup = useCallback((g: SearchResultGroup) => {
    Keyboard.dismiss();
    // Mark selected immediately so onStartClose doesn't trigger router.back().
    hasSelectedTargetRef.current = true;
    // Explicitly close the search sheet. PeopleSearchSheet group rows only call
    // onGroupSelect — they don't call close() themselves. The sheet was
    // disappearing before because selecting a *new* group made isLoadingGroup
    // briefly true → isSettingUp true → early return → whole component unmounted
    // (including PeopleSearchSheet). For a *cached* group isLoadingGroup never
    // becomes true, so nothing unmounted the sheet and it stayed open forever.
    // Explicit close() fixes this for all cases.
    bottomSheetRef.current?.close();
    Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_GROUP_SELECTED, { group_id: g.id });
    setResolvedGroupId(g.id);
    setSelectedFriendId(undefined);
    setSelectedFriendName(undefined);
    // Delay form reveal until the sheet close animation finishes (~300ms) so
    // autoFocus on the amount field doesn't open the keyboard mid-animation.
    setTimeout(() => setHasSelectedTarget(true), 320);
  }, []);

  // Contact selected from sheet
  const handleSelectContact = useCallback(async (contact: EnrichedContact) => {
    setHasSelectedTarget(true);
    Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_CONTACT_SELECTED, { is_existing_user: !!contact.userId });
    setSelectedFriendName(contact.name);
    setSelectedFriendPhone(contact.phone);

    if (contact.userId) {
      setSelectedFriendId(contact.userId);
    } else {
      setIsCreatingShadowUser(true);
      try {
        const normalizedPhone = normalizePhone(contact.phone);
        const { data: existingUser } = await supabase
          .from('users').select('id').eq('phone', normalizedPhone).single() as { data: { id: string } | null };
        if (existingUser) {
          setSelectedFriendId(existingUser.id);
        } else {
          const { data: shadowUser, error: shadowError } = await supabase
            .from('users')
            .insert({ phone: normalizedPhone, name: contact.name, is_registered: false } as any)
            .select('id').single() as { data: { id: string } | null; error: any };
          if (shadowError) {
            const { data: retryUser } = await supabase
              .from('users').select('id').eq('phone', normalizedPhone).single() as { data: { id: string } | null };
            setSelectedFriendId(retryUser?.id ?? undefined);
          } else {
            setSelectedFriendId(shadowUser?.id);
          }
        }
      } finally {
        setIsCreatingShadowUser(false);
      }
    }
  }, []);

  const handleClearSelection = useCallback(() => {
    setHasSelectedTarget(false);
    setResolvedGroupId(undefined);
    setSelectedFriendId(undefined);
    setSelectedFriendName(undefined);
    setSelectedFriendPhone(undefined);
    setSplitBetween([]);
    // PeopleSearchSheet remounts when hasSelectedTarget is false; expand is handled by useEffect([isSearchMode, hasSelectedTarget]).
  }, []);

  // Find or create direct group for friend expenses
  useEffect(() => {
    const setup = async () => {
      const friendId = selectedFriendId || params.friendId;
      if (friendId && user && hasSelectedTarget && !resolvedGroupId) {
        const directGroupId = await findOrCreateDirectGroup(friendId);
        if (directGroupId) setResolvedGroupId(directGroupId);
      }
    };
    setup();
  }, [selectedFriendId, params.friendId, user, findOrCreateDirectGroup, hasSelectedTarget, resolvedGroupId]);

  // Initialize form with group defaults (skipped in edit mode once pre-filled)
  useEffect(() => {
    if (isEditMode) return;
    if (group) {
      setCurrency(group.currency);
      if (user) {
        setPaidBy(user.id);
        setSplitBetween(group.members.map((m) => m.user_id));
      }
    } else if (hasSelectedTarget && user) {
      setPaidBy(user.id);
      const friendId = selectedFriendId || params.friendId;
      if (friendId) {
        setSplitBetween([user.id, friendId]);
      } else if (selectedFriendPhone) {
        setSplitBetween([user.id]);
      }
    }
  }, [group, user, hasSelectedTarget, selectedFriendId, selectedFriendPhone, params.friendId, isEditMode]);

  const getMember = useCallback(
    (userId: string): GroupMember | undefined => group?.members.find((m) => m.user_id === userId),
    [group]
  );

  const splitAmounts = useMemo(() => {
    const total = parseFloat(amount) || 0;
    if (total <= 0 || splitBetween.length === 0) return {};
    const perPerson = total / splitBetween.length;
    const result: Record<string, number> = {};
    splitBetween.forEach((uid) => { result[uid] = Math.round(perPerson * 100) / 100; });
    return result;
  }, [amount, splitBetween]);

  // Total for grouped expense (first line amount + extra lines)
  const totalAmount = useMemo(() => {
    const first = parseFloat(amount) || 0;
    const rest = extraLines.reduce((sum, line) => sum + (parseFloat(line.amount) || 0), 0);
    return first + rest;
  }, [amount, extraLines]);

  const handleAddMoreExpense = useCallback(() => {
    hapticSelection();
    // Value in main description becomes Part 1; parent/group description gets that value so both are set
    setGroupDescription((prev) => prev || description);
    const defaultSplit = group?.members?.map((m) => m.user_id) ?? (user ? [user.id] : []);
    setExtraLines((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          description: '',
          amount: '',
          splitBetween: defaultSplit,
          notes: '',
          paidBy: last?.paidBy || paidBy,
          category: last?.category !== undefined ? last.category : selectedCategory,
        },
      ];
    });
  }, [group?.members, user, description, paidBy, selectedCategory]);

  const updateExtraLine = useCallback((index: number, updates: Partial<ExtraLineDraft>) => {
    setExtraLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const removeExtraLine = useCallback((index: number) => {
    hapticSelection();
    setExtraLines((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // When in grouped layout, removing Part 1 promotes first extra line to main form (Part 1)
  const removePartOne = useCallback(() => {
    if (extraLines.length === 0) return;
    hapticSelection();
    const first = extraLines[0];
    setDescription(first.description);
    setAmount(first.amount);
    setSplitBetween(first.splitBetween);
    setNotes(first.notes ?? '');
    setPaidBy(first.paidBy);
    setSelectedCategory(first.category);
    setExtraLines((prev) => prev.slice(1));
  }, [extraLines]);

  // Grouped layout only when we actually have 2+ parts; when editing and user removes to 1 part, show single-expense UI
  const isGroupedLayout = extraLines.length > 0;

  const toggleExtraLineSplit = useCallback((lineIndex: number, userId: string) => {
    setExtraLines((prev) => {
      const line = prev[lineIndex];
      if (!line) return prev;
      if (line.splitBetween.includes(userId)) {
        const newList = line.splitBetween.filter((id) => id !== userId);
        if (newList.length === 0) {
          hapticWarning();
          return prev;
        }
        if (newList.length === 1 && newList[0] === line.paidBy) {
          hapticWarning();
          return prev;
        }
        hapticSelection();
        const next = [...prev];
        next[lineIndex] = { ...line, splitBetween: newList };
        return next;
      }
      hapticSelection();
      const next = [...prev];
      next[lineIndex] = { ...line, splitBetween: [...line.splitBetween, userId] };
      return next;
    });
  }, []);

  // Keep a ref in sync with activeSheet so the sheet content renders
  // immediately from the ref even before React's async state update commits.
  const activeSheetRef = useRef<'currency' | 'category' | 'paidBy' | null>(null);
  const pickerLineTargetRef = useRef<PickerLineTarget>('main');

  const openSheet = useCallback((type: 'currency' | 'category' | 'paidBy', lineTarget: PickerLineTarget = 'main') => {
    Keyboard.dismiss();
    hapticSelection();
    pickerLineTargetRef.current = lineTarget;
    activeSheetRef.current = type;
    setActiveSheet(type);
    setPickerSheetMounted(true);
  }, []);

  const closeSheet = useCallback(() => {
    pickerSheetRef.current?.close();
  }, []);

  const applyPickerCategory = useCallback((cat: DbCategory | null) => {
    const target = pickerLineTargetRef.current;
    if (target === 'main') setSelectedCategory(cat);
    else updateExtraLine(target, { category: cat });
  }, [updateExtraLine]);

  const applyPickerPaidBy = useCallback((userId: string) => {
    const target = pickerLineTargetRef.current;
    if (target === 'main') setPaidBy(userId);
    else updateExtraLine(target, { paidBy: userId });
  }, [updateExtraLine]);

  // Open picker after mount so the BottomSheet ref exists (first open + remount after unmount).
  useEffect(() => {
    if (!pickerSheetMounted || activeSheet == null) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const type = activeSheetRef.current;
        if (!type) return;
        if (type === 'currency') {
          pickerSheetRef.current?.expand();
        } else {
          pickerSheetRef.current?.snapToIndex(0);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [pickerSheetMounted, activeSheet]);

  const renderPickerBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.45} />
    ),
    []
  );

  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.toLowerCase().trim();
    return Object.entries(CURRENCIES).filter(
      ([code, { name }]) => !q || code.toLowerCase().includes(q) || name.toLowerCase().includes(q)
    );
  }, [currencySearch]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!hasSelectedTarget) newErrors.target = 'Select a group or contact';
    if (isGroupedLayout) {
      if (!groupDescription.trim()) newErrors.groupDescription = 'Group description is required';
      if (!description.trim()) newErrors.description = 'Part 1 description is required';
    } else {
      if (!description.trim()) newErrors.description = 'Description is required';
    }
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) newErrors.amount = 'Enter a valid amount';
    if (!paidBy) newErrors.paidBy = 'Select who paid';
    if (splitBetween.length === 0) newErrors.split = 'Select at least one person to split with';
    else if (splitBetween.length === 1 && splitBetween[0] === paidBy)
      newErrors.split = 'The person who paid cannot be the only one in the split';

    if (extraLines.length > 0) {
      const partNum = (idx: number) => idx + 2;
      extraLines.forEach((line, idx) => {
        if (!line.description.trim()) newErrors[`extraDesc_${idx}`] = `Part ${partNum(idx)} description is required`;
        const lineAmt = parseFloat(line.amount);
        if (!line.amount || isNaN(lineAmt) || lineAmt <= 0) newErrors[`extraAmount_${idx}`] = `Part ${partNum(idx)} amount is required`;
        if (!line.paidBy) newErrors[`extraPaidBy_${idx}`] = `Part ${partNum(idx)}: select who paid`;
        if (line.splitBetween.length === 0) newErrors[`extraSplit_${idx}`] = `Part ${partNum(idx)}: select at least one person to split with`;
        else if (line.splitBetween.length === 1 && line.splitBetween[0] === line.paidBy)
          newErrors[`extraSplit_${idx}`] = `Part ${partNum(idx)}: the person who paid cannot be the only one in the split`;
      });
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) hapticHeavy();
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);

    // ---------- EDIT MODE (single expense) ----------
    if (params.expenseId && existingExpense) {
      const amountNum = parseFloat(amount);
      const newSplitAmount = amountNum / splitBetween.length;
      const newSplits = splitBetween.map((uid) => ({
        user_id: uid,
        amount: Math.round(newSplitAmount * 100) / 100,
      }));
      const success = await updateExpense(
        {
          description: description.trim(),
          amount: amountNum,
          paid_by: paidBy,
          category_id: selectedCategory?.id || null,
          notes: notes.trim() || null,
        },
        newSplits
      );
      setIsSubmitting(false);
      if (success) {
        hapticSuccess();
        router.back();
      } else {
        hapticHeavy();
        setErrors({ form: 'Failed to update expense. Please try again.' });
      }
      return;
    }

    // ---------- EDIT MODE (grouped expense, 2+ parts) ----------
    if (isEditModeGrouped && params.expenseGroupId && extraLines.length >= 1) {
      const groupedFormData: GroupedExpenseFormData = {
        description: groupDescription.trim(),
        category_id: selectedCategory?.id || null,
        paid_by: paidBy,
        currency,
        expense_date: new Date(),
        lines: [
          toGroupedLineForm(description, amount, splitBetween, notes, paidBy, selectedCategory),
          ...extraLines.map((l) => toGroupedLineForm(l.description, l.amount, l.splitBetween, l.notes ?? '', l.paidBy, l.category)),
        ],
      };
      const success = await updateGroupedExpense(params.expenseGroupId, groupedFormData);
      setIsSubmitting(false);
      if (success) {
        hapticSuccess();
        router.back();
      } else {
        hapticHeavy();
        setErrors({ form: 'Failed to update grouped expense. Please try again.' });
      }
      return;
    }

    // ---------- EDIT MODE (grouped expense, user removed to 1 part → update group in place, keep 1 line) ----------
    // Grouped-by-default: we never create a standalone expense; the expense_group stays with one child.
    if (isEditModeGrouped && params.expenseGroupId && extraLines.length === 0) {
      const groupedFormData: GroupedExpenseFormData = {
        description: groupDescription.trim() || description.trim(),
        category_id: selectedCategory?.id || null,
        paid_by: paidBy,
        currency,
        expense_date: new Date(),
        lines: [
          toGroupedLineForm(description, amount, splitBetween, notes, paidBy, selectedCategory),
        ],
      };
      const success = await updateGroupedExpense(params.expenseGroupId, groupedFormData);
      setIsSubmitting(false);
      if (success) {
        hapticSuccess();
        router.back();
      } else {
        hapticHeavy();
        setErrors({ form: 'Failed to update expense. Please try again.' });
      }
      return;
    }

    // ---------- CREATE MODE ----------
    // Handle contact without userId (shadow user path)
    let actualFriendId = selectedFriendId;
    if (!resolvedGroupId && selectedFriendPhone && !actualFriendId && user) {
      const normalizedPhone = normalizePhone(selectedFriendPhone);
      const { data: existingUser } = await supabase
        .from('users').select('id').eq('phone', normalizedPhone).single() as { data: { id: string } | null };
      if (existingUser) {
        actualFriendId = existingUser.id;
      } else {
        const { data: shadowUser, error: shadowError } = await supabase
          .from('users')
          .insert({ phone: normalizedPhone, name: selectedFriendName || 'Unknown', is_registered: false } as any)
          .select('id').single() as { data: { id: string } | null; error: any };
        if (shadowError || !shadowUser) {
          setErrors({ form: 'Failed to add contact. Please try again.' });
          setIsSubmitting(false);
          return;
        }
        actualFriendId = shadowUser.id;
      }
      if (!actualFriendId) {
        setErrors({ form: 'Failed to find or create contact. Please try again.' });
        setIsSubmitting(false);
        return;
      }
      const directGroupId = await findOrCreateDirectGroup(actualFriendId);
      if (!directGroupId) {
        setErrors({ form: 'Failed to create expense. Please try again.' });
        setIsSubmitting(false);
        return;
      }
      // Grouped-by-default: always create via createGroupedExpense (1 or more lines). When 2+ parts, parent = groupDescription.
      const groupedFormData: GroupedExpenseFormData = {
        description: extraLines.length >= 1 ? groupDescription.trim() : description.trim(),
        category_id: selectedCategory?.id || null,
        paid_by: paidBy || user!.id,
        currency,
        expense_date: new Date(),
        lines:
          extraLines.length >= 1
            ? [
                toGroupedLineForm(description, amount, splitBetween, notes, paidBy || user!.id, selectedCategory),
                ...extraLines.map((l) => toGroupedLineForm(l.description, l.amount, l.splitBetween, l.notes ?? '', l.paidBy || user!.id, l.category)),
              ]
            : [toGroupedLineForm(description, amount, splitBetween, notes, paidBy || user!.id, selectedCategory)],
      };
      const groupId = await createGroupedExpense(groupedFormData, directGroupId);
      setIsSubmitting(false);
      if (groupId) {
        Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_COMPLETED, {
          expense_id: groupId,
          amount: parseFloat(amount),
          currency,
          category_id: selectedCategory?.id,
          category_name: selectedCategory?.name,
          split_type: 'equal_selected',
          member_count: splitBetween.length,
          is_group_expense: extraLines.length >= 1,
          has_notes: notes.trim().length > 0,
        });
        hapticSuccess();
        router.back();
      } else {
        Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_FAILED, { error_stage: 'submission' });
        setErrors({ form: extraLines.length >= 1 ? 'Failed to create grouped expense. Please try again.' : 'Failed to create expense. Please try again.' });
      }
      return;
    }

    // Normal group path (or direct with resolvedGroupId). When 2+ parts, parent = groupDescription.
    const groupedFormData: GroupedExpenseFormData = {
      description: extraLines.length >= 1 ? groupDescription.trim() : description.trim(),
      category_id: selectedCategory?.id || null,
      paid_by: paidBy,
      currency,
      expense_date: new Date(),
      lines:
        extraLines.length >= 1
          ? [
              toGroupedLineForm(description, amount, splitBetween, notes, paidBy, selectedCategory),
              ...extraLines.map((l) => toGroupedLineForm(l.description, l.amount, l.splitBetween, l.notes ?? '', l.paidBy, l.category)),
            ]
          : [toGroupedLineForm(description, amount, splitBetween, notes, paidBy, selectedCategory)],
    };
    const groupId = await createGroupedExpense(groupedFormData, resolvedGroupId);
    setIsSubmitting(false);
    if (groupId) {
      Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_COMPLETED, {
        expense_id: groupId,
        amount: parseFloat(amount),
        currency,
        category_id: selectedCategory?.id,
        category_name: selectedCategory?.name,
        split_type: splitType,
        member_count: splitBetween.length,
        is_group_expense: extraLines.length >= 1,
        has_notes: notes.trim().length > 0,
      });
      hapticSuccess();
      router.back();
    } else {
      Analytics.track(EXPENSE_EVENTS.ADD_EXPENSE_FAILED, { error_stage: 'submission' });
      setErrors({ form: extraLines.length >= 1 ? 'Failed to create grouped expense. Please try again.' : 'Failed to create expense. Please try again.' });
    }
  };

  const toggleMemberInSplit = (userId: string) => {
    setSplitBetween((prev) => {
      if (prev.includes(userId)) {
        const newList = prev.filter((id) => id !== userId);
        if (newList.length === 0) { hapticWarning(); return prev; }
        if (newList.length === 1 && newList[0] === paidBy) { hapticWarning(); return prev; }
        hapticSelection();
        return newList;
      }
      hapticSelection();
      return [...prev, userId];
    });
  };

  // Loading: setting up group or direct flow
  const isSettingUp = hasSelectedTarget && (
    isLoadingGroup || isCreatingDirectGroup || isCreatingShadowUser
    || (selectedFriendId && !resolvedGroupId)
  );

  const saveHeaderAction = (
    <HeaderSaveButton
      onPress={handleSubmit}
      loading={isSubmitting}
      disabled={isSubmitting}
      label={isEditMode ? 'Save' : ''}
    />
  );

  if (isSettingUp && !isEditMode) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={screenTitle} headerRight={saveHeaderAction} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>Setting up…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasPreselection && !group && !isDirectExpense && !isSearchMode && !isEditMode) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={screenTitle} />
        <View style={styles.errorContainer}>
          <IconSymbol name="exclamationmark.circle" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: textColor }]}>Group not found</Text>
          <Button title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  // Determine target label for the banner
  const targetLabel = selectedFriendName
    ? `With ${selectedFriendName}`
    : isDirectExpense
      ? `With ${params.friendName || 'Friend'}`
      : group?.name || (isEditMode && existingExpense ? 'Loading…' : 'Loading…');

  const isFriendTarget = !!(selectedFriendId || selectedFriendName || isDirectExpense);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title={screenTitle} headerRight={saveHeaderAction} />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {isEditModeGrouped && isLoadingExpenseGroup ? (
            <View style={[styles.loadingContainer, { backgroundColor }]}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text style={[styles.loadingText, { color: secondaryTextColor }]}>Loading expense…</Text>
            </View>
          ) : (hasPreselection || hasSelectedTarget || isEditMode) ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Target Banner ── */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 40 }}
              >
                <View style={[styles.targetBanner, { backgroundColor: cardBg }]}>
                  <View style={[
                    styles.targetIcon,
                    { backgroundColor: isFriendTarget ? colors.success + '20' : colors.primary[500] + '18' },
                  ]}>
                    <IconSymbol
                      name={isFriendTarget ? 'person' : 'person.2.fill'}
                      size={20}
                      color={isFriendTarget ? colors.success : colors.primary[500]}
                    />
                  </View>
                  <View style={styles.targetInfo}>
                    <Text style={[styles.targetLabel, { color: secondaryTextColor }]}>
                      {isEditMode ? 'EDITING IN' : isFriendTarget ? 'WITH' : 'GROUP'}
                    </Text>
                    <Text style={[styles.targetName, { color: textColor }]} numberOfLines={1}>
                      {targetLabel}
                    </Text>
                  </View>
                  {isSearchMode && hasSelectedTarget && !isEditMode && (
                    <Pressable
                      onPress={handleClearSelection}
                      style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <IconSymbol name="xmark.circle" size={22} color={secondaryTextColor} />
                    </Pressable>
                  )}
                </View>
              </MotiView>

              {/* ── Single-expense layout: description, amount hero, paid by, split, notes ── */}
              {!isGroupedLayout && (
                <>
                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 90 }}
                    style={styles.section}
                  >
                    <View style={[styles.descriptionCard, { backgroundColor: cardBg, borderColor }]}>
                      <Pressable
                        onPress={() => openSheet('category')}
                        style={({ pressed }) => [
                          styles.categoryTile,
                          { borderRightColor: borderColor },
                          selectedCategory ? { backgroundColor: selectedCategory.color + '18' } : {},
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        {selectedCategory ? (
                          <Text style={styles.categoryTileEmoji}>{selectedCategory.icon}</Text>
                        ) : (
                          <IconSymbol name="square.grid.2x2" size={20} color={secondaryTextColor} />
                        )}
                      </Pressable>
                      <TextInput
                        style={[styles.descriptionInput, { color: textColor }]}
                        placeholder="What's this expense for?"
                        placeholderTextColor={isDark ? colors.gray[600] : colors.gray[400]}
                        value={description}
                        onChangeText={setDescription}
                        returnKeyType="done"
                      />
                    </View>
                    {errors.description ? <Text style={styles.errorMessage}>{errors.description}</Text> : null}
                  </MotiView>

                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 140 }}
                    style={[styles.amountHero, { backgroundColor: colors.primary[500] + '0D' }]}
                  >
                    <View style={styles.amountRow}>
                      <Pressable
                        onPress={() => {
                          showPlatformAlert('Coming Soon', 'Support for other currencies is on the way!');
                        }}
                        style={({ pressed }) => [
                          styles.currencyPill,
                          { borderRightColor: borderColor, opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <Text style={[styles.currencyPillSymbol, { color: colors.primary[500] }]}>
                          {CURRENCIES[currency].symbol}
                        </Text>
                        <Text style={[styles.currencyPillCode, { color: secondaryTextColor }]}>
                          {currency}
                        </Text>
                        <IconSymbol name="chevron.down" size={12} color={secondaryTextColor} />
                      </Pressable>
                      <TextInput
                        style={[styles.amountInput, { color: textColor }]}
                        placeholder="0.00"
                        placeholderTextColor={isDark ? colors.gray[600] : colors.gray[300]}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        autoFocus={!isEditMode}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                        textAlign="center"
                      />
                    </View>
                    {errors.amount ? <Text style={styles.amountError}>{errors.amount}</Text> : null}
                  </MotiView>

                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 190 }}
                    style={styles.section}
                  >
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>PAID BY</Text>
                    <Pressable
                      onPress={() => openSheet('paidBy')}
                      style={[styles.selectorRow, { backgroundColor: cardBg, borderColor }]}
                    >
                      {paidBy ? (
                        <View style={styles.selectorLeft}>
                          {getMember(paidBy) && (
                            <Avatar user={getMember(paidBy)!.user} size={30} style={{ marginRight: 10 }} />
                          )}
                          <Text style={[styles.selectorValue, { color: textColor }]}>
                            {paidBy === user?.id ? 'You' : getMember(paidBy)?.user.name || 'Unknown'}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.selectorLeft}>
                          <View style={[styles.selectorIconWrap, { backgroundColor: borderColor }]}>
                            <IconSymbol name="person" size={16} color={secondaryTextColor} />
                          </View>
                          <Text style={[styles.selectorPlaceholder, { color: secondaryTextColor }]}>
                            Who paid?
                          </Text>
                        </View>
                      )}
                      <IconSymbol name="chevron.down" size={18} color={secondaryTextColor} />
                    </Pressable>
                    {errors.paidBy ? <Text style={styles.errorMessage}>{errors.paidBy}</Text> : null}
                  </MotiView>

                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 240 }}
                    style={styles.section}
                  >
                    {isFriendTarget && targetLabel && (
                      <Text style={[styles.splitHint, { color: secondaryTextColor }]}>
                        Split between you and {targetLabel}
                      </Text>
                    )}
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>
                      SPLIT BETWEEN{splitBetween.length > 0 ? ` · ${splitBetween.length} ${splitBetween.length === 1 ? 'person' : 'people'}` : ''}
                    </Text>
                    <View style={[styles.splitList, { backgroundColor: cardBg }]}>
                      {(group?.members || []).map((member, idx) => {
                        const isSelected = splitBetween.includes(member.user_id);
                        const splitAmount = splitAmounts[member.user_id];
                        const isLast = idx === (group?.members.length ?? 0) - 1;
                        return (
                          <Pressable
                            key={member.user_id}
                            style={({ pressed }) => [
                              styles.splitItem,
                              !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
                              { transform: [{ scale: pressed ? 0.98 : 1 }] },
                            ]}
                            onPress={() => toggleMemberInSplit(member.user_id)}
                          >
                            <Avatar user={member.user} size={34} style={{ marginRight: 12 }} />
                            <Text style={[styles.splitName, { color: textColor }]}>
                              {member.user_id === user?.id ? 'You' : member.user.name}
                            </Text>
                            <View style={styles.splitRight}>
                              {isSelected && splitAmount > 0 && (
                                <Text style={[styles.splitAmount, { color: secondaryTextColor }]}>
                                  {CURRENCIES[currency].symbol}{splitAmount.toFixed(2)}
                                </Text>
                              )}
                              <Checkbox checked={isSelected} borderColor={borderColor} />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    {errors.split ? <Text style={styles.errorMessage}>{errors.split}</Text> : null}
                  </MotiView>
                </>
              )}

              {/* ── Grouped layout: group-level category + paid by, total band, Part 1 card, Add more, Part 2+ cards ── */}
              {isGroupedLayout && (
                <>
                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 90 }}
                    style={styles.section}
                  >
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>DESCRIPTION (GROUP)</Text>
                    <TextInput
                      style={[styles.extraLineInput, { color: textColor, borderColor, backgroundColor: cardBg }]}
                      placeholder="What's this payment for? (e.g. Dinner at club)"
                      placeholderTextColor={isDark ? colors.gray[600] : colors.gray[400]}
                      value={groupDescription}
                      onChangeText={setGroupDescription}
                      returnKeyType="done"
                    />
                    {errors.groupDescription ? <Text style={styles.errorMessage}>{errors.groupDescription}</Text> : null}
                  </MotiView>

                  {/* Total band (separate from Part 1) */}
                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 140 }}
                    style={[styles.totalBand, { backgroundColor: colors.primary[500] + '0D', borderColor }]}
                  >
                    <Text style={[styles.totalLabel, { color: secondaryTextColor }]}>
                      TOTAL · {CURRENCIES[currency].symbol}{totalAmount.toFixed(2)}
                    </Text>
                    <Pressable
                      onPress={() => {
                        showPlatformAlert('Coming Soon', 'Support for other currencies is on the way!');
                      }}
                      style={({ pressed }) => [styles.currencyPillSmall, { borderColor, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={[styles.currencyPillSymbol, { color: colors.primary[500] }]}>{CURRENCIES[currency].symbol}</Text>
                      <Text style={[styles.currencyPillCode, { color: secondaryTextColor }]}>{currency}</Text>
                      <IconSymbol name="chevron.down" size={12} color={secondaryTextColor} />
                    </Pressable>
                  </MotiView>

                  {/* Part 1 card (same structure as Part 2+) */}
                  <MotiView
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 160 }}
                    style={[styles.extraLineCard, { backgroundColor: cardBg, borderColor }]}
                  >
                    <View style={styles.extraLineCardHeader}>
                      <Text style={[styles.extraLineTitle, { color: secondaryTextColor }]}>Part 1</Text>
                      {extraLines.length >= 1 && (
                        <Pressable onPress={removePartOne} hitSlop={8} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                          <IconSymbol name="trash.fill" size={20} color={colors.error} />
                        </Pressable>
                      )}
                    </View>
                    <TextInput
                      style={[styles.extraLineInput, { color: textColor, borderColor }]}
                      placeholder="What's this part for? (required)"
                      placeholderTextColor={isDark ? colors.gray[600] : colors.gray[400]}
                      value={description}
                      onChangeText={setDescription}
                      returnKeyType="done"
                    />
                    {errors.description ? <Text style={styles.errorMessage}>{errors.description}</Text> : null}
                    <View style={styles.extraLineAmountRow}>
                      <Text style={[styles.extraLineCurrency, { color: secondaryTextColor }]}>{CURRENCIES[currency].symbol}</Text>
                      <TextInput
                        style={[styles.extraLineAmountInput, { color: textColor }]}
                        placeholder="0.00"
                        placeholderTextColor={isDark ? colors.gray[600] : colors.gray[300]}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </View>
                    {errors.amount ? <Text style={styles.errorMessage}>{errors.amount}</Text> : null}
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>CATEGORY</Text>
                    <Pressable
                      onPress={() => openSheet('category', 'main')}
                      style={[styles.selectorRow, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50], borderColor }]}
                    >
                      {selectedCategory ? (
                        <View style={styles.selectorLeft}>
                          <Text style={styles.categoryTileEmoji}>{selectedCategory.icon}</Text>
                          <Text style={[styles.selectorValue, { color: textColor, marginLeft: 10 }]}>{selectedCategory.name}</Text>
                        </View>
                      ) : (
                        <View style={styles.selectorLeft}>
                          <View style={[styles.selectorIconWrap, { backgroundColor: borderColor }]}>
                            <IconSymbol name="square.grid.2x2" size={16} color={secondaryTextColor} />
                          </View>
                          <Text style={[styles.selectorPlaceholder, { color: secondaryTextColor }]}>
                            Choose category
                          </Text>
                        </View>
                      )}
                      <IconSymbol name="chevron.down" size={18} color={secondaryTextColor} />
                    </Pressable>
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>PAID BY</Text>
                    <Pressable
                      onPress={() => openSheet('paidBy', 'main')}
                      style={[styles.selectorRow, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50], borderColor }]}
                    >
                      {paidBy ? (
                        <View style={styles.selectorLeft}>
                          {getMember(paidBy) && (
                            <Avatar user={getMember(paidBy)!.user} size={30} style={{ marginRight: 10 }} />
                          )}
                          <Text style={[styles.selectorValue, { color: textColor }]}>
                            {paidBy === user?.id ? 'You' : getMember(paidBy)?.user.name || 'Unknown'}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.selectorLeft}>
                          <View style={[styles.selectorIconWrap, { backgroundColor: borderColor }]}>
                            <IconSymbol name="person" size={16} color={secondaryTextColor} />
                          </View>
                          <Text style={[styles.selectorPlaceholder, { color: secondaryTextColor }]}>
                            Who paid?
                          </Text>
                        </View>
                      )}
                      <IconSymbol name="chevron.down" size={18} color={secondaryTextColor} />
                    </Pressable>
                    {errors.paidBy ? <Text style={styles.errorMessage}>{errors.paidBy}</Text> : null}
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>
                      SPLIT BETWEEN{splitBetween.length > 0 ? ` · ${splitBetween.length} ${splitBetween.length === 1 ? 'person' : 'people'}` : ''}
                    </Text>
                    {isFriendTarget && targetLabel && (
                      <Text style={[styles.splitHint, { color: secondaryTextColor, marginBottom: 6 }]}>
                        Split between you and {targetLabel}
                      </Text>
                    )}
                    <View style={[styles.splitList, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50] }]}>
                      {(group?.members || []).map((member, idx) => {
                        const isSelected = splitBetween.includes(member.user_id);
                        const splitAmount = splitAmounts[member.user_id];
                        const isLast = idx === (group?.members.length ?? 0) - 1;
                        return (
                          <Pressable
                            key={member.user_id}
                            style={({ pressed }) => [
                              styles.splitItem,
                              !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
                              { transform: [{ scale: pressed ? 0.98 : 1 }] },
                            ]}
                            onPress={() => toggleMemberInSplit(member.user_id)}
                          >
                            <Avatar user={member.user} size={34} style={{ marginRight: 12 }} />
                            <Text style={[styles.splitName, { color: textColor }]}>
                              {member.user_id === user?.id ? 'You' : member.user.name}
                            </Text>
                            <View style={styles.splitRight}>
                              {isSelected && splitAmount > 0 && (
                                <Text style={[styles.splitAmount, { color: secondaryTextColor }]}>
                                  {CURRENCIES[currency].symbol}{splitAmount.toFixed(2)}
                                </Text>
                              )}
                              <Checkbox checked={isSelected} borderColor={borderColor} />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    {errors.split ? <Text style={styles.errorMessage}>{errors.split}</Text> : null}
                    <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>NOTES (OPTIONAL)</Text>
                    <Input
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Add a note for this part…"
                      placeholderTextColor={isDark ? colors.gray[500] : colors.gray[400]}
                      multiline
                      numberOfLines={2}
                      leftIcon={
                        <IconSymbol name="bubble.left" size={20} color={isDark ? colors.gray[400] : colors.gray[500]} />
                      }
                    />
                  </MotiView>
                </>
              )}

              {/* ── Extra lines (grouped expense: Part 2, Part 3, …) ── */}
              {extraLines.length > 0 && extraLines.map((line, idx) => (
                <MotiView
                  key={idx}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200 }}
                  style={[styles.extraLineCard, { backgroundColor: cardBg, borderColor }]}
                >
                  <View style={styles.extraLineCardHeader}>
                    <Text style={[styles.extraLineTitle, { color: secondaryTextColor }]}>
                      Part {idx + 2}
                    </Text>
                    {extraLines.length >= 1 && (
                      <Pressable
                        onPress={() => removeExtraLine(idx)}
                        hitSlop={8}
                        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                      >
                        <IconSymbol name="trash.fill" size={20} color={colors.error} />
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    style={[styles.extraLineInput, { color: textColor, borderColor }]}
                    placeholder="What's this part for?"
                    placeholderTextColor={isDark ? colors.gray[600] : colors.gray[400]}
                    value={line.description}
                    onChangeText={(text) => updateExtraLine(idx, { description: text })}
                    returnKeyType="done"
                  />
                  {errors[`extraDesc_${idx}`] ? <Text style={styles.errorMessage}>{errors[`extraDesc_${idx}`]}</Text> : null}
                  <View style={styles.extraLineAmountRow}>
                    <Text style={[styles.extraLineCurrency, { color: secondaryTextColor }]}>{CURRENCIES[currency].symbol}</Text>
                    <TextInput
                      style={[styles.extraLineAmountInput, { color: textColor }]}
                      placeholder="0.00"
                      placeholderTextColor={isDark ? colors.gray[600] : colors.gray[300]}
                      value={line.amount}
                      onChangeText={(text) => updateExtraLine(idx, { amount: text })}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                    />
                  </View>
                  {errors[`extraAmount_${idx}`] ? <Text style={styles.errorMessage}>{errors[`extraAmount_${idx}`]}</Text> : null}
                  <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>CATEGORY</Text>
                  <Pressable
                    onPress={() => openSheet('category', idx)}
                    style={[styles.selectorRow, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50], borderColor }]}
                  >
                    {line.category ? (
                      <View style={styles.selectorLeft}>
                        <Text style={styles.categoryTileEmoji}>{line.category.icon}</Text>
                        <Text style={[styles.selectorValue, { color: textColor, marginLeft: 10 }]}>{line.category.name}</Text>
                      </View>
                    ) : (
                      <View style={styles.selectorLeft}>
                        <View style={[styles.selectorIconWrap, { backgroundColor: borderColor }]}>
                          <IconSymbol name="square.grid.2x2" size={16} color={secondaryTextColor} />
                        </View>
                        <Text style={[styles.selectorPlaceholder, { color: secondaryTextColor }]}>
                          Choose category
                        </Text>
                      </View>
                    )}
                    <IconSymbol name="chevron.down" size={18} color={secondaryTextColor} />
                  </Pressable>
                  <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>PAID BY</Text>
                  <Pressable
                    onPress={() => openSheet('paidBy', idx)}
                    style={[styles.selectorRow, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50], borderColor }]}
                  >
                    {line.paidBy ? (
                      <View style={styles.selectorLeft}>
                        {getMember(line.paidBy) && (
                          <Avatar user={getMember(line.paidBy)!.user} size={30} style={{ marginRight: 10 }} />
                        )}
                        <Text style={[styles.selectorValue, { color: textColor }]}>
                          {line.paidBy === user?.id ? 'You' : getMember(line.paidBy)?.user.name || 'Unknown'}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.selectorLeft}>
                        <View style={[styles.selectorIconWrap, { backgroundColor: borderColor }]}>
                          <IconSymbol name="person" size={16} color={secondaryTextColor} />
                        </View>
                        <Text style={[styles.selectorPlaceholder, { color: secondaryTextColor }]}>
                          Who paid?
                        </Text>
                      </View>
                    )}
                    <IconSymbol name="chevron.down" size={18} color={secondaryTextColor} />
                  </Pressable>
                  {errors[`extraPaidBy_${idx}`] ? <Text style={styles.errorMessage}>{errors[`extraPaidBy_${idx}`]}</Text> : null}
                  <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>
                    SPLIT BETWEEN{line.splitBetween.length > 0 ? ` · ${line.splitBetween.length} ${line.splitBetween.length === 1 ? 'person' : 'people'}` : ''}
                  </Text>
                  <View style={[styles.splitList, { backgroundColor: isDark ? colors.gray[800] : colors.gray[50] }]}>
                    {(group?.members || []).map((member, mi) => {
                      const isSelected = line.splitBetween.includes(member.user_id);
                      const lineAmt = line.splitBetween.length > 0 ? (parseFloat(line.amount) || 0) / line.splitBetween.length : 0;
                      const splitAmount = isSelected ? Math.round(lineAmt * 100) / 100 : 0;
                      const isLast = mi === (group?.members?.length ?? 0) - 1;
                      return (
                        <Pressable
                          key={member.user_id}
                          style={({ pressed }) => [
                            styles.splitItem,
                            !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
                            { transform: [{ scale: pressed ? 0.98 : 1 }] },
                          ]}
                          onPress={() => toggleExtraLineSplit(idx, member.user_id)}
                        >
                          <Avatar user={member.user} size={34} style={{ marginRight: 12 }} />
                          <Text style={[styles.splitName, { color: textColor }]}>
                            {member.user_id === user?.id ? 'You' : member.user.name}
                          </Text>
                          <View style={styles.splitRight}>
                            {isSelected && splitAmount > 0 && (
                              <Text style={[styles.splitAmount, { color: secondaryTextColor }]}>
                                {CURRENCIES[currency].symbol}{splitAmount.toFixed(2)}
                              </Text>
                            )}
                            <Checkbox checked={isSelected} borderColor={borderColor} />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  {errors[`extraSplit_${idx}`] ? <Text style={styles.errorMessage}>{errors[`extraSplit_${idx}`]}</Text> : null}
                  <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12 }]}>NOTES (OPTIONAL)</Text>
                  <Input
                    value={line.notes}
                    onChangeText={(text) => updateExtraLine(idx, { notes: text })}
                    placeholder="Add a note for this part…"
                    placeholderTextColor={isDark ? colors.gray[500] : colors.gray[400]}
                    multiline
                    numberOfLines={2}
                    leftIcon={
                      <IconSymbol name="bubble.left" size={20} color={isDark ? colors.gray[400] : colors.gray[500]} />
                    }
                  />
                </MotiView>
              ))}

              {/* ── Add more expense at bottom of list (create or edit grouped) ── */}
              {(!isEditMode || isEditModeGrouped) && (
                <MotiView
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 260 }}
                  style={styles.section}
                >
                  <Pressable
                    onPress={handleAddMoreExpense}
                    style={({ pressed }) => [
                      styles.addMoreButton,
                      { backgroundColor: colors.primary[500] + '18', borderColor: colors.primary[500] + '40', opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <IconSymbol name="plus.circle" size={22} color={colors.primary[500]} />
                    <Text style={[styles.addMoreButtonText, { color: colors.primary[500] }]}>Add more expense</Text>
                  </Pressable>
                </MotiView>
              )}

              {/* ── Notes (single expense only; grouped uses per-part notes above and in cards) ── */}
              {extraLines.length === 0 && !isEditModeGrouped && (
                <MotiView
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 290 }}
                >
                  <Input
                    label="Notes (optional)"
                    placeholder="Add any additional notes…"
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={2}
                    leftIcon={
                      <IconSymbol
                        name="bubble.left"
                        size={20}
                        color={isDark ? colors.gray[400] : colors.gray[500]}
                      />
                    }
                  />
                </MotiView>
              )}

              {/* ── Form error ── */}
              {errors.form ? (
                <Text style={[styles.errorMessage, { marginBottom: 8 }]}>{errors.form}</Text>
              ) : null}

            </ScrollView>
          ) : null}
        </KeyboardAvoidingView>

        {/* Picker bottom sheet — only mounted while in use; unmounted when closed (Android touch fix). */}
        {pickerSheetMounted && (
        <BottomSheet
          ref={pickerSheetRef}
          index={-1}
          snapPoints={['50%', '75%']}
          enablePanDownToClose
          onChange={(index) => {
            if (index === -1) {
              setCurrencySearch('');
              // Remove closed sheet from tree after close animation — avoids @gorhom/bottom-sheet
              // Android bug where index=-1 still intercepts all touches.
              setTimeout(() => setPickerSheetMounted(false), 400);
            }
          }}
          backgroundComponent={SheetBackground}
          backgroundStyle={{ backgroundColor: 'transparent' }}
          handleIndicatorStyle={{ backgroundColor: borderColor }}
          backdropComponent={renderPickerBackdrop}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
        >
          <BottomSheetScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sheetTitle, { color: textColor }]}>
              {(activeSheet ?? activeSheetRef.current) === 'currency'
                ? 'Select Currency'
                : (activeSheet ?? activeSheetRef.current) === 'category'
                  ? 'Select Category'
                  : 'Who Paid?'}
            </Text>

            {/* Currency list with search */}
            {(activeSheet ?? activeSheetRef.current) === 'currency' && (
              <>
                <BottomSheetTextInput
                  style={[
                    styles.currencySearchInput,
                    { backgroundColor: isDark ? colors.gray[700] : colors.gray[100], color: textColor },
                  ]}
                  placeholder="Search currencies…"
                  placeholderTextColor={secondaryTextColor}
                  value={currencySearch}
                  onChangeText={setCurrencySearch}
                  clearButtonMode="while-editing"
                  autoCorrect={false}
                />
                {filteredCurrencies.map(([code, { symbol, name }]) => (
                  <Pressable
                    key={code}
                    style={({ pressed }) => [
                      styles.sheetItem,
                      { borderBottomColor: borderColor },
                      currency === code && { backgroundColor: colors.primary[500] + '22', borderRadius: 10 },
                      { opacity: pressed ? 0.75 : 1 },
                    ]}
                    onPress={() => {
                      hapticSelection();
                      setCurrency(code as CurrencyCode);
                      closeSheet();
                    }}
                  >
                    <View style={styles.sheetItemLeft}>
                      <Text style={[styles.currencyItemSymbol, { color: colors.primary[500] }]}>{symbol}</Text>
                      <View>
                        <Text style={[styles.sheetItemTitle, { color: textColor }]}>{code}</Text>
                        <Text style={[styles.sheetItemSubtitle, { color: secondaryTextColor }]}>{name}</Text>
                      </View>
                    </View>
                    {currency === code && <IconSymbol name="checkmark" size={18} color={colors.primary[500]} />}
                  </Pressable>
                ))}
              </>
            )}

            {/* Category grid */}
            {(activeSheet ?? activeSheetRef.current) === 'category' && (
              <View style={styles.categorySheetGrid}>
                <Pressable
                  style={({ pressed }) => [
                    styles.categorySheetItem,
                    !(pickerLineTargetRef.current === 'main' ? selectedCategory : extraLines[pickerLineTargetRef.current]?.category) && { backgroundColor: colors.gray[500] + '20', borderColor: colors.gray[400] },
                    { opacity: pressed ? 0.75 : 1 },
                  ]}
                  onPress={() => { hapticSelection(); applyPickerCategory(null); closeSheet(); }}
                >
                  <Text style={[styles.categorySheetEmoji, { color: secondaryTextColor }]}>—</Text>
                  <Text
                    style={[styles.categorySheetName, { color: secondaryTextColor }]}
                    numberOfLines={1}
                  >
                    None
                  </Text>
                </Pressable>
                {categories.map((cat) => {
                  const activeCat = pickerLineTargetRef.current === 'main'
                    ? selectedCategory
                    : extraLines[pickerLineTargetRef.current]?.category;
                  const isActive = activeCat?.id === cat.id;
                  return (
                  <Pressable
                    key={cat.id}
                    style={({ pressed }) => [
                      styles.categorySheetItem,
                      isActive && { backgroundColor: cat.color + '20', borderColor: cat.color },
                      { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
                    ]}
                    onPress={() => { hapticSelection(); applyPickerCategory(cat); closeSheet(); }}
                  >
                    <Text style={styles.categorySheetEmoji}>{cat.icon}</Text>
                    <Text
                      style={[
                        styles.categorySheetName,
                        { color: isActive ? cat.color : textColor },
                      ]}
                      numberOfLines={1}
                    >
                      {cat.name}
                    </Text>
                  </Pressable>
                  );
                })}
              </View>
            )}

            {/* Paid by member list */}
            {(activeSheet ?? activeSheetRef.current) === 'paidBy' && group && group.members.map((member) => {
              const activePaidBy = pickerLineTargetRef.current === 'main'
                ? paidBy
                : extraLines[pickerLineTargetRef.current]?.paidBy;
              const isActive = activePaidBy === member.user_id;
              return (
              <Pressable
                key={member.user_id}
                style={({ pressed }) => [
                  styles.sheetItem,
                  { borderBottomColor: borderColor },
                  isActive && { backgroundColor: colors.primary[500] + '22', borderRadius: 10 },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => { hapticSelection(); applyPickerPaidBy(member.user_id); closeSheet(); }}
              >
                <View style={styles.sheetItemLeft}>
                  <Avatar user={member.user} size={36} style={{ marginRight: 12 }} />
                  <Text style={[styles.sheetItemTitle, { color: textColor }]}>
                    {member.user_id === user?.id ? 'You' : member.user.name}
                  </Text>
                </View>
                {isActive && <IconSymbol name="checkmark" size={18} color={colors.primary[500]} />}
              </Pressable>
              );
            })}
          </BottomSheetScrollView>
        </BottomSheet>
        )}

        {/* People search sheet — only until a target is chosen (unmount avoids closed sheet blocking Android touches). */}
        {isSearchMode && !hasSelectedTarget && (
          <PeopleSearchSheet
            ref={bottomSheetRef}
            title="Add Expense"
            showGroups
            onGroupSelect={handleSelectGroup}
            onContactSelect={handleSelectContact}
            onStartClose={() => {
              if (!hasSelectedTargetRef.current) {
                setTimeout(() => router.back(), 100);
              }
            }}
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },

  // Nav
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveButton: {
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 48,
  },

  // Target banner
  targetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
    gap: 12,
  },
  targetIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetInfo: {
    flex: 1,
  },
  targetLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  targetName: {
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    padding: 4,
  },

  // Amount hero — inline row layout
  amountHero: {
    borderRadius: 18,
    marginBottom: 16,
    overflow: 'hidden',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  currencyPillSymbol: {
    fontSize: 20,
    fontWeight: '700',
  },
  currencyPillCode: {
    fontSize: 13,
    fontWeight: '600',
  },
  amountInput: {
    flex: 1,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1,
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 16,
  },
  amountError: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    paddingBottom: 10,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textAlign: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  totalBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  currencyPillSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  splitHint: {
    fontSize: 13,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  addMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addMoreButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  extraLineCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  extraLineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  extraLineTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  extraLineInput: {
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  extraLineAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  extraLineCurrency: {
    fontSize: 18,
    fontWeight: '600',
    marginRight: 6,
  },
  extraLineAmountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  // Description + category compound row
  descriptionCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  categoryTile: {
    width: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  categoryTileEmoji: {
    fontSize: 22,
  },
  descriptionInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 50,
  },

  // Paid by selector row (trigger only — picker moved to sheet)
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  selectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  selectorIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  selectorValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  selectorPlaceholder: {
    fontSize: 15,
  },

  // Picker bottom sheet
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 4,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sheetItemTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  sheetItemSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  currencyItemSymbol: {
    fontSize: 20,
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
    marginRight: 12,
  },
  currencySearchInput: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  categorySheetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  categorySheetItem: {
    width: '30%',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 6,
  },
  categorySheetEmoji: {
    fontSize: 26,
  },
  categorySheetName: {
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },

  // Split list
  splitList: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  splitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  splitName: {
    flex: 1,
    fontSize: 15,
  },
  splitRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  splitAmount: {
    fontSize: 14,
    fontWeight: '500',
  },

  errorMessage: {
    color: colors.error,
    fontSize: 13,
    marginTop: 8,
    marginLeft: 4,
  },

  submitContainer: {
    marginTop: 16,
  },
});
