/**
 * Profile Screen
 *
 * Stack route for viewing and editing user profile (opened from Home avatar).
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { colors } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useSettings, type ThemeMode } from '@/contexts/settings-context';
import { useSync } from '@/contexts/sync-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUser } from '@/hooks/use-user';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '@/lib/haptics';
import {
  isPushNotificationsEnabled,
  registerForPushNotificationsAsync,
  unregisterForPushNotificationsAsync,
} from '@/lib/notifications';
import { NativeScreenHeader } from '@/lib/native-header';
import { deleteImage, getPathFromUrl, pickImageFromCamera, pickImageFromLibrary, uploadAvatar } from '@/lib/image-upload';
import {
  showOfflineAlert,
  showPhotoSourcePicker,
  showPlatformAlert,
  showPlatformConfirm,
  showPlatformPicker,
} from '@/lib/platform-picker';
import { CURRENCIES } from '@/types/database';

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { user: authUser, signOut } = useAuth();
  const { isOnline } = useSync();
  const { user, updateUser, isLoading: isUserLoading, refresh } = useUser();
  const { 
    themeMode, 
    setThemeMode, 
    defaultCurrency,
  } = useSettings();

  // Edit mode state
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const nameInputRef = useRef<TextInput>(null);

  // Initialize name from user data
  useEffect(() => {
    const userName = user?.name || authUser?.user_metadata?.name || '';
    setName(userName);
  }, [user, authUser]);

  // Exit edit mode when going offline
  useEffect(() => {
    if (!isOnline && isEditingName) {
      setIsEditingName(false);
      // Reset name to original
      const userName = user?.name || authUser?.user_metadata?.name || '';
      setName(userName);
    }
  }, [isOnline, isEditingName, user, authUser]);

  const handleEditName = () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Editing your profile requires an internet connection.');
      return;
    }
    setIsEditingName(true);
    setError('');
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const handleCancelNameEdit = () => {
    setIsEditingName(false);
    setError('');
    // Reset name to original
    const userName = user?.name || authUser?.user_metadata?.name || '';
    setName(userName);
  };

  const handleSaveName = async () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Updating your profile requires an internet connection.');
      return;
    }

    const trimmedName = name.trim();
    
    if (!trimmedName) {
      setError('Name is required');
      return;
    }

    if (trimmedName.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const success = await updateUser({ name: trimmedName });
      
      if (success) {
        setIsEditingName(false);
        await refresh();
      } else {
        setError('Failed to update name. Please try again.');
      }
    } catch (err) {
      console.error('[Profile] Save error:', err);
      setError('Something went wrong. Please try again later.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoUpload = async (uri: string) => {
    if (!authUser) return;
    
    setIsUploadingPhoto(true);
    try {
      const result = await uploadAvatar(uri, authUser.id);
      
      if (result.success && result.url) {
        // Update user profile with new avatar URL
        const success = await updateUser({ avatar_url: result.url });
        if (success) {
          hapticSuccess();
          await refresh();
        } else {
          hapticWarning();
          showPlatformAlert('Error', 'Failed to update profile. Please try again.');
        }
      } else {
        hapticWarning();
        showPlatformAlert('Error', result.error || 'Failed to upload photo. Please try again.');
      }
    } catch (err) {
      console.error('[Profile] Photo upload error:', err);
      hapticWarning();
      showPlatformAlert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleTakePhoto = async () => {
    // Double-check offline status (user might have gone offline while action sheet was open)
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Changing your photo requires an internet connection.');
      return;
    }
    hapticSelection();
    const uri = await pickImageFromCamera();
    if (uri) {
      await handlePhotoUpload(uri);
    }
  };

  const handleChooseFromLibrary = async () => {
    // Double-check offline status (user might have gone offline while action sheet was open)
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Changing your photo requires an internet connection.');
      return;
    }
    hapticSelection();
    const uri = await pickImageFromLibrary();
    if (uri) {
      await handlePhotoUpload(uri);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user?.avatar_url) return;
    
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Removing your photo requires an internet connection.');
      return;
    }
    
    hapticSelection();
    setIsUploadingPhoto(true);
    
    try {
      // Delete from storage
      const path = getPathFromUrl(user.avatar_url, 'avatars');
      if (path) {
        await deleteImage('avatars', path);
      }
      
      // Update user profile
      const success = await updateUser({ avatar_url: null });
      if (success) {
        hapticSuccess();
        await refresh();
      } else {
        hapticWarning();
        showPlatformAlert('Error', 'Failed to remove photo. Please try again.');
      }
    } catch (err) {
      console.error('[Profile] Remove photo error:', err);
      hapticWarning();
      showPlatformAlert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const guardOnlineForPhotoChange = () => {
    if (!isOnline) {
      hapticWarning();
      showOfflineAlert('Changing your photo requires an internet connection.');
      return false;
    }
    return true;
  };

  const handleChangePhoto = () => {
    if (isUploadingPhoto) return;
    if (!guardOnlineForPhotoChange()) return;

    showPhotoSourcePicker({
      title: 'Change Profile Photo',
      hasExistingPhoto: !!user?.avatar_url,
      onTakePhoto: () => {
        if (!guardOnlineForPhotoChange()) return;
        void handleTakePhoto();
      },
      onChooseFromLibrary: () => {
        if (!guardOnlineForPhotoChange()) return;
        void handleChooseFromLibrary();
      },
      onRemovePhoto: handleRemovePhoto,
    });
  };

  const handleLogout = () => {
    showPlatformConfirm({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign Out',
      destructive: true,
      onConfirm: signOut,
    });
  };

  const handleThemeChange = () => {
    hapticSelection();
    const options: ThemeMode[] = ['system', 'light', 'dark'];
    const labels = ['System Default', 'Light', 'Dark'];

    showPlatformPicker({
      title: 'Choose Theme',
      options: options.map((mode, index) => ({
        label: labels[index],
        selected: themeMode === mode,
        onPress: () => setThemeMode(mode),
      })),
    });
  };

  const handleCurrencyChange = () => {
    hapticLight();
    showPlatformAlert(
      'Coming Soon',
      'Multi-currency support is on the way. For now, expenses use your group\'s default currency.',
      'Got it',
    );
    // --- Future implementation ---
    // Full currency picker will be re-enabled here once backend supports
    // per-user default currency and multi-currency expense conversion.
    // The action sheet / Alert.alert picker code has been removed; restore from
    // git history (commit before feat: expense screen redesign) when ready.
  };

  const notificationsEnabled = user?.notifications_enabled !== false;

  const handleNotificationToggle = async (value: boolean) => {
    hapticLight();
    if (!isOnline) {
      showOfflineAlert('Connect to the internet to change notification settings.');
      return;
    }

    if (value) {
      const token = await registerForPushNotificationsAsync();
      if (!token) {
        showPlatformAlert(
          'Notifications unavailable',
          'Allow notifications in system settings, then try again. Remote push also needs a device with Google Play services.',
        );
        return;
      }
    } else {
      await unregisterForPushNotificationsAsync();
    }

    const success = await updateUser({ notifications_enabled: value });
    if (!success) {
      showPlatformAlert('Could not save', 'Notification preference was not updated. Please try again.');
    }
  };

  const handleAbout = () => {
    hapticLight();
    router.push('/settings/about');
  };

  const getThemeLabel = () => {
    switch (themeMode) {
      case 'system': return 'System';
      case 'light': return 'Light';
      case 'dark': return 'Dark';
    }
  };

  const getCurrencyLabel = () => {
    const currency = CURRENCIES[defaultCurrency];
    return currency ? `${currency.symbol} ${defaultCurrency}` : defaultCurrency;
  };

  // Get user info
  const userName = user?.name || authUser?.user_metadata?.name || 'User';
  const userPhone = user?.phone || authUser?.user_metadata?.phone || '';

  // Format phone for display
  const formatPhone = (phone: string) => {
    if (phone.startsWith('+')) {
      const countryCode = phone.slice(0, 3);
      const number = phone.slice(3);
      return `${countryCode} ${number.slice(0, 5)} ${number.slice(5)}`;
    }
    return phone;
  };

  // Theme colors
  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;
  const cardBg = isDark ? colors.gray[800] : colors.white;
  const inputBg = isDark ? colors.gray[700] : colors.gray[50];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
      <NativeScreenHeader title="Profile" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar Section */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 15, delay: 100 }}
            style={styles.avatarSection}
          >
            <Avatar
              user={{ name: userName, avatar_url: user?.avatar_url ?? null }}
              size={100}
              mode="edit"
              onEditPress={handleChangePhoto}
              isUploading={isUploadingPhoto}
              disabled={!isOnline}
            />
          </MotiView>

          {/* Profile Card */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 200 }}
            style={[styles.card, { backgroundColor: cardBg }]}
          >
            {/* Error Message */}
            {error && (
              <MotiView
                from={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={styles.errorContainer}
              >
                <IconSymbol name="exclamationmark.circle" size={18} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </MotiView>
            )}

            {/* Name Field */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: secondaryTextColor }]}>
                Full Name
              </Text>
              {isEditingName ? (
                <View style={[styles.fieldValue, styles.fieldValueEditing, { backgroundColor: inputBg, borderColor: colors.primary[500] }]}>
                  <IconSymbol
                    name="person"
                    size={20}
                    color={colors.primary[500]}
                  />
                  <TextInput
                    ref={nameInputRef}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter your name"
                    placeholderTextColor={isDark ? colors.gray[500] : colors.gray[400]}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={handleSaveName}
                    onBlur={handleCancelNameEdit}
                    editable={isOnline}
                    style={[
                      styles.nameInput, 
                      { color: textColor, opacity: !isOnline ? 0.5 : 1 }
                    ]}
                  />
                  {isSaving ? (
                    <View style={styles.savingIndicator}>
                      <Text style={[styles.savingText, { color: colors.primary[500] }]}>Saving...</Text>
                    </View>
                  ) : (
                    <Pressable 
                      onPress={handleSaveName}
                      disabled={!isOnline}
                      style={[
                        styles.saveButton, 
                        { backgroundColor: colors.primary[500], opacity: !isOnline ? 0.5 : 1 }
                      ]}
                    >
                      <Text style={styles.saveButtonText}>Save</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <Pressable 
                  onPress={handleEditName}
                  disabled={!isOnline}
                  style={{ opacity: !isOnline ? 0.5 : 1 }}
                >
                  <View style={[styles.fieldValue, { backgroundColor: inputBg }]}>
                    <IconSymbol
                      name="person"
                      size={20}
                      color={isDark ? colors.gray[400] : colors.gray[500]}
                    />
                    <Text style={[styles.fieldValueText, { color: textColor }]}>
                      {userName}
                    </Text>
                    <IconSymbol
                      name="pencil"
                      size={18}
                      color={colors.primary[500]}
                    />
                  </View>
                </Pressable>
              )}
            </View>

            {/* Phone Field (Read-only) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: secondaryTextColor }]}>
                Phone Number
              </Text>
              <View style={[styles.fieldValue, { backgroundColor: inputBg }]}>
                <IconSymbol
                  name="phone"
                  size={20}
                  color={isDark ? colors.gray[400] : colors.gray[500]}
                />
                <Text style={[styles.fieldValueText, { color: textColor }]}>
                  {formatPhone(userPhone)}
                </Text>
                <View style={styles.verifiedBadge}>
                  <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              </View>
            </View>

          </MotiView>

          {/* Preferences Section */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 300 }}
            style={[styles.card, { backgroundColor: cardBg }]}
          >
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Preferences
            </Text>

            {/* Theme Selector */}
            <Pressable 
              style={styles.settingItem}
              onPress={handleThemeChange}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: colors.primary[100] }]}>
                  <IconSymbol 
                    name={isDark ? 'moon.fill' : 'sun.max'} 
                    size={20} 
                    color={colors.primary[500]} 
                  />
                </View>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Theme
                </Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingValue, { color: secondaryTextColor }]}>
                  {getThemeLabel()}
                </Text>
                <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
              </View>
            </Pressable>

            {/* Default Currency */}
            <Pressable 
              style={[
                styles.settingItem, 
                { opacity: !isOnline ? 0.5 : 1 }
              ]}
              onPress={handleCurrencyChange}
              disabled={!isOnline}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: colors.success + '20' }]}>
                  <IconSymbol name="dollarsign.circle" size={20} color={colors.success} />
                </View>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Default Currency
                </Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingValue, { color: secondaryTextColor }]}>
                  {getCurrencyLabel()}
                </Text>
                <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
              </View>
            </Pressable>

            {isPushNotificationsEnabled() ? (
              <View
                style={[
                  styles.settingItem,
                  styles.settingItemLast,
                  { opacity: !isOnline ? 0.5 : 1 },
                ]}
              >
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.warning + '20' }]}>
                    <IconSymbol name="bell" size={20} color={colors.warning} />
                  </View>
                  <Text style={[styles.settingLabel, { color: textColor }]}>
                    Notifications
                  </Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleNotificationToggle}
                  disabled={!isOnline}
                  trackColor={{ false: colors.gray[300], true: colors.primary[400] }}
                  thumbColor={notificationsEnabled ? colors.primary[500] : colors.gray[100]}
                />
              </View>
            ) : null}
          </MotiView>

          {/* About Section */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 350 }}
            style={[styles.card, { backgroundColor: cardBg }]}
          >
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              About
            </Text>

            {/* Help & Support */}
            <Pressable 
              style={styles.settingItem}
              onPress={handleAbout}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: colors.info + '20' }]}>
                  <IconSymbol name="questionmark.circle" size={20} color={colors.info} />
                </View>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Help & Support
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>

            {/* Privacy Policy */}
            <Pressable 
              style={styles.settingItem}
              onPress={handleAbout}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: colors.gray[200] }]}>
                  <IconSymbol name="doc.text" size={20} color={colors.gray[600]} />
                </View>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Privacy Policy
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>

            {/* Terms of Service */}
            <Pressable 
              style={[styles.settingItem, styles.settingItemLast]}
              onPress={handleAbout}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: colors.gray[200] }]}>
                  <IconSymbol name="checkmark.shield" size={20} color={colors.gray[600]} />
                </View>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Terms of Service
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={secondaryTextColor} />
            </Pressable>
          </MotiView>

          {/* Sign Out Button */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 400 }}
            style={styles.signOutContainer}
          >
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.signOutButton,
                { 
                  backgroundColor: isDark ? colors.gray[800] : colors.gray[100],
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color={colors.error} />
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </MotiView>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
    position: 'relative',
  },
  card: {
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '15',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    flex: 1,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 12,
  },
  fieldValueEditing: {
    borderWidth: 2,
  },
  fieldValueText: {
    fontSize: 16,
    flex: 1,
  },
  nameInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  savingIndicator: {
    paddingHorizontal: 8,
  },
  savingText: {
    fontSize: 12,
    fontWeight: '500',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedText: {
    fontSize: 12,
    color: colors.success,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  settingItemLast: {
    borderBottomWidth: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontSize: 16,
  },
  settingValue: {
    fontSize: 14,
    marginRight: 4,
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signOutContainer: {
    marginTop: 8,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
  versionContainer: {
    alignItems: 'center',
    marginTop: 24,
  },
  versionText: {
    fontSize: 13,
  },
});
