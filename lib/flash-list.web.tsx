/**
 * FlashList is unreliable on web (null scroll refs crash @gorhom/bottom-sheet).
 * Metro aliases @shopify/flash-list here for the web platform only.
 */
import { forwardRef } from 'react';
import { FlatList, type FlatListProps } from 'react-native';

type FlashListProps<T> = FlatListProps<T> & {
  estimatedItemSize?: number;
  getItemType?: (item: T, index: number, extraData?: unknown) => string | number | undefined;
};

function FlashListInner<T>(
  { estimatedItemSize: _estimatedItemSize, getItemType: _getItemType, ...props }: FlashListProps<T>,
  ref: React.ForwardedRef<FlatList<T>>
) {
  return <FlatList ref={ref} {...props} />;
}

export const FlashList = forwardRef(FlashListInner) as <T>(
  props: FlashListProps<T> & { ref?: React.Ref<FlatList<T>> }
) => React.ReactElement | null;

export default FlashList;
