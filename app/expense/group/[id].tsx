/**
 * Grouped Expense Detail Screen
 *
 * Same receipt-style layout as single expense: header (description, category, date, total, paid by)
 * plus one block per line (line description, amount, split between X people).
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { colors } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useExpenseGroup } from '@/hooks/use-expense-group';
import { useGroup } from '@/hooks/use-group';
import { hapticHeavy, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { showPlatformAlert, showPlatformConfirm } from '@/lib/platform-picker';
import { HeaderIconButton, NativeScreenHeader } from '@/lib/native-header';
import type { CurrencyCode } from '@/types';
import { CURRENCIES } from '@/types/database';

export default function ExpenseGroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const { expenseGroup, isLoading, error, canEdit, deleteExpenseGroup } = useExpenseGroup(id);
  const { group } = useGroup(expenseGroup?.group.group_id);

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;
  const separatorColor = isDark ? colors.gray[700] : colors.gray[200];
  const cardBorderColor = isDark ? 'transparent' : colors.gray[200];

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const formatCurrency = (value: number, currency: CurrencyCode) =>
    `${CURRENCIES[currency].symbol}${value.toFixed(2)}`;

  const handleEdit = () => {
    if (!expenseGroup) return;
    router.push({
      pathname: '/add-expense',
      params: { expenseGroupId: id, groupId: expenseGroup.group.group_id },
    });
  };

  const handleDelete = () => {
    hapticHeavy();
    showPlatformConfirm({
      title: 'Delete Grouped Expense',
      message:
        'Are you sure? This will remove the entire grouped expense and all its parts. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        setIsDeleting(true);
        const success = await deleteExpenseGroup();
        setIsDeleting(false);
        if (success) {
          hapticSuccess();
          router.back();
        } else {
          hapticWarning();
          showPlatformAlert('Error', 'Failed to delete. Please try again.');
        }
      },
    });
  };

  const headerRight = canEdit && !isLoading && expenseGroup ? (
    <HeaderIconButton icon="pencil" onPress={handleEdit} color={colors.primary[500]} />
  ) : undefined;

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title="Expense Details" />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.receiptCard, { backgroundColor: cardBg, borderColor: cardBorderColor }]}>
            <View style={[styles.receiptTop, { backgroundColor: colors.primary[500] + '0E' }]}>
              <View style={styles.receiptTopMeta}>
                <Skeleton width={90} height={11} borderRadius={6} />
                <Skeleton width={70} height={11} borderRadius={6} />
              </View>
              <Skeleton width={160} height={24} borderRadius={8} style={{ marginTop: 14, marginBottom: 12 }} />
              <Skeleton width={120} height={44} borderRadius={10} />
            </View>
            <View style={[styles.separator, { backgroundColor: separatorColor }]} />
            <View style={styles.receiptSection}>
              <Skeleton width={52} height={10} borderRadius={5} style={{ marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Skeleton circle width={36} height={36} />
                <Skeleton width={110} height={16} borderRadius={8} />
              </View>
            </View>
            <View style={[styles.dashedSeparator, { borderColor: separatorColor }]} />
            <View style={styles.receiptSection}>
              <Skeleton width={130} height={10} borderRadius={5} style={{ marginBottom: 14 }} />
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.splitRow, { marginBottom: i < 2 ? 14 : 0 }]}>
                  <Skeleton circle width={32} height={32} />
                  <Skeleton width={100} height={14} borderRadius={7} style={{ flex: 1 }} />
                  <Skeleton width={68} height={14} borderRadius={7} />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Error
  if (error || !expenseGroup) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
        <NativeScreenHeader title="Expense Details" />
        <View style={styles.errorContainer}>
          <IconSymbol name="exclamationmark.circle" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: textColor }]}>
            {error || 'Grouped expense not found'}
          </Text>
          <Button title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const { group: eg, lines } = expenseGroup;
  const expenseDate = eg.created_at?.split('T')[0] ?? eg.created_at;
  const showMetaSection = group && group.type !== 'direct';
  const isSingleLine = lines.length === 1;
  const singleLine = isSingleLine ? lines[0] : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
      <NativeScreenHeader title="Expense Details" headerRight={headerRight} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 24 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180, delay: 60 }}
          style={[styles.receiptCard, { backgroundColor: cardBg, borderColor: cardBorderColor }]}
        >
          {/* Top band: category · date · title · total. For single-line, use line description as title. */}
          <View style={[styles.receiptTop, { backgroundColor: colors.primary[500] + '0E' }]}>
            <View style={styles.receiptTopMeta}>
              {isSingleLine ? (
                (singleLine?.category ?? eg.category) ? (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryPillEmoji}>{(singleLine?.category ?? eg.category)!.icon}</Text>
                    <Text style={[styles.categoryPillName, { color: secondaryTextColor }]}>
                      {(singleLine?.category ?? eg.category)!.name}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.categoryPill}>
                    <IconSymbol name="doc.text" size={12} color={secondaryTextColor} />
                    <Text style={[styles.categoryPillName, { color: secondaryTextColor }]}>
                      Expense
                    </Text>
                  </View>
                )
              ) : (
                <Text style={[styles.categoryPillName, { color: secondaryTextColor }]}>
                  {lines.length} PARTS
                </Text>
              )}
              <Text style={[styles.receiptDate, { color: secondaryTextColor }]}>
                {formatDate(expenseDate)}
              </Text>
            </View>

            <Text style={[styles.receiptTitle, { color: textColor }]} numberOfLines={2}>
              {isSingleLine && singleLine ? singleLine.description : eg.description}
            </Text>
            <Text style={[styles.receiptAmount, { color: textColor }]}>
              {formatCurrency(eg.total, lines[0]?.currency ?? 'INR')}
            </Text>
          </View>

          {isSingleLine && (
            <>
              <View style={[styles.separator, { backgroundColor: separatorColor }]} />
              <View style={styles.receiptSection}>
                <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>PAID BY</Text>
                <View style={styles.paidByRow}>
                  <Avatar user={singleLine?.paid_by_user ?? eg.paid_by_user} size={36} />
                  <Text style={[styles.paidByName, { color: textColor }]}>
                    {(singleLine?.paid_by_user ?? eg.paid_by_user).id === user?.id
                      ? 'You'
                      : (singleLine?.paid_by_user ?? eg.paid_by_user).name}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Multi-line: one block per line. Single-line: one split block only (no duplicate line row). */}
          {isSingleLine && singleLine ? (
            <>
              <View style={[styles.dashedSeparator, { borderColor: separatorColor }]} />
              <View style={styles.receiptSection}>
                <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginBottom: 14 }]}>
                  SPLIT BETWEEN {singleLine.splits.length} {singleLine.splits.length === 1 ? 'PERSON' : 'PEOPLE'}
                </Text>
                {singleLine.splits.map((split, splitIndex) => (
                  <View
                    key={split.user_id}
                    style={[styles.splitRow, splitIndex < singleLine.splits.length - 1 && styles.splitRowGap]}
                  >
                    <Avatar user={split.user} size={32} />
                    <Text style={[styles.splitName, { color: textColor }]}>
                      {split.user_id === user?.id ? 'You' : split.user.name}
                    </Text>
                    <Text style={[styles.splitAmount, { color: secondaryTextColor }]}>
                      {formatCurrency(split.amount, singleLine.currency)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            lines.map((line) => (
              <View key={line.id}>
                <View style={[styles.dashedSeparator, { borderColor: separatorColor }]} />
                <View style={styles.receiptSection}>
                  <View style={styles.lineHeaderRow}>
                    <Text style={[styles.lineTitle, { color: textColor }]} numberOfLines={1}>
                      {line.description}
                    </Text>
                    <Text style={[styles.lineAmount, { color: textColor }]}>
                      {formatCurrency(line.amount, line.currency)}
                    </Text>
                  </View>
                  <View style={styles.lineMetaRow}>
                    {line.category ? (
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryPillEmoji}>{line.category.icon}</Text>
                        <Text style={[styles.categoryPillName, { color: secondaryTextColor }]}>
                          {line.category.name}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.linePaidBy}>
                      <Avatar user={line.paid_by_user} size={22} />
                      <Text style={[styles.linePaidByName, { color: secondaryTextColor }]}>
                        {line.paid_by_user.id === user?.id ? 'You' : line.paid_by_user.name}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.sectionLabel, { color: secondaryTextColor, marginTop: 12, marginBottom: 14 }]}>
                    SPLIT BETWEEN {line.splits.length} {line.splits.length === 1 ? 'PERSON' : 'PEOPLE'}
                  </Text>
                  {line.splits.map((split, splitIndex) => (
                    <View
                      key={split.user_id}
                      style={[styles.splitRow, splitIndex < line.splits.length - 1 && styles.splitRowGap]}
                    >
                      <Avatar user={split.user} size={32} />
                      <Text style={[styles.splitName, { color: textColor }]}>
                        {split.user_id === user?.id ? 'You' : split.user.name}
                      </Text>
                      <Text style={[styles.splitAmount, { color: secondaryTextColor }]}>
                        {formatCurrency(split.amount, line.currency)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}

          {/* Footer: group name (if not direct) */}
          {showMetaSection && (
            <>
              <View style={[styles.dashedSeparator, { borderColor: separatorColor }]} />
              <View style={styles.receiptSection}>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: secondaryTextColor }]}>Group</Text>
                  <View style={styles.metaValueRow}>
                    <Avatar group={group} size={20} />
                    <Text style={[styles.metaValue, { color: textColor }]}>{group.name}</Text>
                  </View>
                </View>
              </View>
            </>
          )}
        </MotiView>

        {canEdit && (
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 180, delay: 180 }}
            style={styles.actionsContainer}
          >
            <Pressable
              onPress={handleDelete}
              disabled={isDeleting}
              style={({ pressed }) => [
                styles.deleteButton,
                { opacity: pressed || isDeleting ? 0.6 : 1 },
              ]}
            >
              <IconSymbol name="trash.fill" size={16} color={colors.error} />
              <Text style={styles.deleteButtonText}>
                {isDeleting ? 'Deleting…' : 'Delete Grouped Expense'}
              </Text>
            </Pressable>
          </MotiView>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 18, fontWeight: '600' },
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
    textAlign: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 52,
  },
  receiptCard: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  receiptTop: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 20,
  },
  receiptTopMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  categoryPillEmoji: { fontSize: 13 },
  categoryPillName: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  receiptDate: { fontSize: 11, fontWeight: '500' },
  receiptTitle: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
    lineHeight: 28,
    marginBottom: 6,
  },
  receiptAmount: {
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1.5,
  },
  separator: { height: StyleSheet.hairlineWidth },
  dashedSeparator: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    marginHorizontal: 20,
  },
  receiptSection: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  paidByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paidByName: { fontSize: 16, fontWeight: '600' },
  lineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  lineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  linePaidBy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linePaidByName: { fontSize: 13, fontWeight: '500' },
  lineTitle: { fontSize: 16, fontWeight: '600', flex: 1 },
  lineAmount: { fontSize: 18, fontWeight: '600' },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  splitRowGap: { marginBottom: 14 },
  splitName: { flex: 1, fontSize: 15 },
  splitAmount: { fontSize: 15, fontWeight: '500' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 10,
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: '500',
    width: 46,
    paddingTop: 1,
  },
  metaValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  metaValue: { fontSize: 14, flex: 1 },
  actionsContainer: {
    marginTop: 20,
    gap: 10,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.error,
  },
});
