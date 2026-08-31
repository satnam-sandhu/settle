/**
 * Web surface — no Liquid Glass / native blur.
 */

import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { platform } from '@/constants/colors';

export type FrostedSurfaceVariant = 'elevated' | 'flat';

interface FrostedSurfaceProps extends Pick<ViewProps, 'pointerEvents'> {
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  elevation?: number;
  variant?: FrostedSurfaceVariant;
  blurIntensity?: number;
}

export function FrostedSurface({
  isDark,
  style,
  children,
  elevation = 3,
  variant = 'elevated',
  pointerEvents,
}: FrostedSurfaceProps) {
  const surfaceColor = isDark ? platform.surface.dark : platform.surface.light;

  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        style,
        {
          backgroundColor: surfaceColor,
          elevation: variant === 'elevated' ? elevation : 0,
        },
      ]}
    >
      {children}
    </View>
  );
}
