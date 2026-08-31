/**
 * Cross-platform dialogs — ActionSheet pickers on iOS, Alert on Android.
 */

import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type PlatformPickerOption = {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  selected?: boolean;
};

export type PlatformPickerConfig = {
  title?: string;
  message?: string;
  cancelLabel?: string;
  options: PlatformPickerOption[];
};

export type PlatformConfirmConfig = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export type PhotoSourcePickerConfig = {
  title?: string;
  message?: string;
  hasExistingPhoto?: boolean;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
  onRemovePhoto?: () => void;
};

/** Multi-option picker — ActionSheet on iOS, Alert button list on Android */
export function showPlatformPicker({
  title,
  message,
  cancelLabel = 'Cancel',
  options,
}: PlatformPickerConfig) {
  if (Platform.OS === 'ios') {
    const labels = options.map((o) => o.label + (o.selected ? ' ✓' : ''));
    const destructiveIndex = options.findIndex((o) => o.destructive);

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [cancelLabel, ...labels],
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex + 1 : undefined,
        title,
        message,
      },
      (buttonIndex) => {
        if (buttonIndex > 0) {
          options[buttonIndex - 1].onPress?.();
        }
      },
    );
    return;
  }

  Alert.alert(
    title ?? '',
    message,
    [
      { text: cancelLabel, style: 'cancel' },
      ...options.map((option) => ({
        text: option.label + (option.selected ? ' ✓' : ''),
        style: option.destructive ? ('destructive' as const) : ('default' as const),
        onPress: option.onPress,
      })),
    ],
  );
}

/** Destructive / confirmation dialog — native Alert on both platforms */
export function showPlatformConfirm({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: PlatformConfirmConfig) {
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
}

/** Standard take-photo / library / optional remove flow */
export function showPhotoSourcePicker({
  title = 'Photo',
  message = 'Choose an option',
  hasExistingPhoto = false,
  onTakePhoto,
  onChooseFromLibrary,
  onRemovePhoto,
}: PhotoSourcePickerConfig) {
  const options: PlatformPickerOption[] = [
    ...(Platform.OS === 'web'
      ? []
      : [{ label: 'Take Photo', onPress: onTakePhoto }]),
    {
      label: Platform.OS === 'web' ? 'Choose photo' : 'Choose from Library',
      onPress: onChooseFromLibrary,
    },
  ];

  if (hasExistingPhoto && onRemovePhoto) {
    options.push({
      label: 'Remove Photo',
      onPress: onRemovePhoto,
      destructive: true,
    });
  }

  showPlatformPicker({ title, message, options });
}

/** Simple informational alert */
export function showPlatformAlert(
  title: string,
  message?: string,
  buttonLabel = 'OK',
  onPress?: () => void,
) {
  Alert.alert(title, message, [{ text: buttonLabel, onPress }]);
}

/** Offline guard message used across the app */
export function showOfflineAlert(message: string, title = 'No Connection') {
  showPlatformAlert(title, message);
}
