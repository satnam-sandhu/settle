// Fallback for web — uses Material Icons via SF Symbol mapping.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SymbolWeight } from 'expo-symbols';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

import { ICON_SYMBOL_MAPPING, type IconSymbolName } from '@/components/ui/icon-symbol-mapping';

export type { IconSymbolName } from '@/components/ui/icon-symbol-mapping';

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return (
    <MaterialIcons
      color={color}
      size={size}
      name={ICON_SYMBOL_MAPPING[name]}
      style={style}
    />
  );
}
