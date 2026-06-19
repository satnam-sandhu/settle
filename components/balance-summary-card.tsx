/**
 * Home balance summary — frosted card with net balance, sub-stats, and settle pill.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';

import { Skeleton } from '@/components/ui/skeleton';
import { FrostedSurface } from '@/components/ui/frosted-surface';
import { colors } from '@/constants/colors';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hapticLight, hapticWarning } from '@/lib/haptics';
import { showOfflineAlert } from '@/lib/platform-picker';
import { formatCurrency } from '@/lib/utils';

/** Matches FilterScrubber show/hide spring feel */
const CARD_ENTRY_SPRING = { type: 'spring' as const, damping: 28, stiffness: 180 };

export interface BalanceSummaryCardProps {
  netBalance: number;
  /** Money you get back from friends */
  totalOwed: number;
  /** Money you owe friends */
  totalOwing: number;
  isLoading: boolean;
  onSettleUp: () => void;
  /** Stagger after header entry (ms) */
  animationDelay?: number;
}

export function BalanceSummaryCard({
  netBalance,
  totalOwed,
  totalOwing,
  isLoading,
  onSettleUp,
  animationDelay = 150,
}: BalanceSummaryCardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { isOnline } = useSync();

  const primaryTextColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;

  const heroLabel =
    netBalance > 0 ? 'You are owed' : netBalance < 0 ? 'You owe' : 'All settled up';

  const netColor =
    netBalance > 0
      ? colors.success
      : netBalance < 0
        ? colors.error
        : secondaryTextColor;

  const hasOutstanding = totalOwed > 0 || totalOwing > 0;

  const handleSettlePress = () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Settling up requires an internet connection.');
      return;
    }
    hapticLight();
    onSettleUp();
  };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 20, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ ...CARD_ENTRY_SPRING, delay: animationDelay }}
    >
      <FrostedSurface isDark={isDark} variant="elevated" style={styles.card}>
      <Text style={[styles.heroLabel, { color: secondaryTextColor }]}>{heroLabel}</Text>

      {isLoading ? (
        <>
          <Skeleton
            width={130}
            height={38}
            borderRadius={8}
            style={styles.heroSkeleton}
          />
          <View style={styles.subStatsRow}>
            <Skeleton width={95} height={18} borderRadius={6} style={styles.subStatSkeleton} />
            <Skeleton width={95} height={18} borderRadius={6} style={styles.subStatSkeleton} />
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.heroAmount, { color: netColor }]}>
            {formatCurrency(Math.abs(netBalance))}
          </Text>

          <View style={styles.subStatsRow}>
            <View style={styles.subStat}>
              <Text style={[styles.subStatLabel, { color: secondaryTextColor }]}>
                You get back
              </Text>
              <Text style={[styles.subStatValue, { color: primaryTextColor }]}>
                {formatCurrency(totalOwed)}
              </Text>
            </View>
            <View style={[styles.subStatDivider, { backgroundColor: secondaryTextColor }]} />
            <View style={styles.subStat}>
              <Text style={[styles.subStatLabel, { color: secondaryTextColor }]}>
                You owe
              </Text>
              <Text style={[styles.subStatValue, { color: primaryTextColor }]}>
                {formatCurrency(totalOwing)}
              </Text>
            </View>
          </View>

          {hasOutstanding && (
            <Pressable
              onPress={handleSettlePress}
              style={({ pressed }) => [
                styles.settlePillPressable,
                { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <FrostedSurface isDark={isDark} variant="flat" style={styles.settlePill}>
                <Text style={[styles.settlePillText, { color: primaryTextColor }]}>
                  Settle up →
                </Text>
              </FrostedSurface>
            </Pressable>
          )}
        </>
      )}
      </FrostedSurface>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    overflow: 'hidden',
  },
  heroLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  heroAmount: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 20,
  },
  heroSkeleton: {
    marginVertical: 4,
    opacity: 0.35,
  },
  subStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subStat: {
    flex: 1,
  },
  subStatLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  subStatValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  subStatDivider: {
    width: 1,
    height: 36,
    opacity: 0.25,
    marginHorizontal: 16,
  },
  subStatSkeleton: {
    flex: 1,
    opacity: 0.3,
  },
  settlePillPressable: {
    marginTop: 20,
    alignSelf: 'flex-start',
  },
  settlePill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  settlePillText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
