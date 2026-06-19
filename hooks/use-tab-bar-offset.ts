/**
 * Layout offsets for floating UI above native tab bars.
 *
 * The add/search affordance is a native `NativeTabs.Trigger role="search"` tab —
 * not a custom overlay — so offsets only account for the tab bar + FilterScrubber.
 */

import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_LAYOUT = {
  NATIVE_TAB_BAR_HEIGHT: Platform.select({
    ios: 49,
    android: 80,
    default: 56,
  })!,
  /** Expanded FilterScrubber height — keep in sync with filter-scrubber EXPANDED_H */
  SCRUBBER_HEIGHT: 56,
  SCRUBBER_GAP: 12,
  LIST_CLEARANCE: 24,
} as const;

export function useTabBarOffset() {
  const insets = useSafeAreaInsets();
  const { NATIVE_TAB_BAR_HEIGHT, SCRUBBER_HEIGHT, SCRUBBER_GAP, LIST_CLEARANCE } =
    TAB_BAR_LAYOUT;

  const tabBarOffset = insets.bottom + NATIVE_TAB_BAR_HEIGHT;

  if (Platform.OS === 'ios') {
    const scrubberBottom = NATIVE_TAB_BAR_HEIGHT + SCRUBBER_GAP;
    const listPaddingBottom = scrubberBottom + SCRUBBER_HEIGHT + LIST_CLEARANCE;
    const contentPaddingBottom = NATIVE_TAB_BAR_HEIGHT + LIST_CLEARANCE;

    return {
      tabBarOffset,
      scrubberBottom,
      listPaddingBottom,
      contentPaddingBottom,
    };
  }

  const scrubberBottom = tabBarOffset + SCRUBBER_GAP;
  const listPaddingBottom = scrubberBottom + SCRUBBER_HEIGHT + LIST_CLEARANCE;
  const contentPaddingBottom = tabBarOffset + LIST_CLEARANCE;

  return {
    tabBarOffset,
    scrubberBottom,
    listPaddingBottom,
    contentPaddingBottom,
  };
}
