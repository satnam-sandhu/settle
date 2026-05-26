/**
 * Set Password Screen - Step 3
 * 
 * Create password after OTP verification.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiText, MotiView } from 'moti';
import { useRef, useState, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { colors } from '@/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';
import { AUTH_EVENTS } from '@/lib/analytics-events';

export default function SetPasswordScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const params = useLocalSearchParams<{ phone: string; name: string; signupToken: string }>();

  const phone = params.phone || '';
  const name = params.name || '';
  const signupToken = params.signupToken || '';

  // Form state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Refs
  const confirmPasswordRef = useRef<TextInput>(null);

  // Track screen view
  useEffect(() => {
    Analytics.trackScreen('set_password');
  }, []);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      newErrors.password = 'Password must contain letters and numbers';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateAccount = async () => {
posthog.capture('create_an_account')
    if (!validateForm()) return;

    setIsLoading(true);
    setErrors({});

    try {
      // Call Edge Function to create account with signed token
      const { data, error } = await supabase.functions.invoke('create-account', {
        body: { signupToken, password, name },
      });

      // If we have valid data response, use it (includes business logic errors)
      if (data && typeof data.success === 'boolean') {
        if (!data.success) {
          Analytics.track(AUTH_EVENTS.SIGN_UP_FAILED, { 
            error_stage: 'password_set',
            error_type: 'account_creation_failed',
          });
          setErrors({ form: data.message || 'Failed to create account. Please try again.' });
          return;
        }
      } else if (error) {
        // Technical error - don't show details to user
        console.error('[SetPassword] Error:', error);
        Analytics.track(AUTH_EVENTS.SIGN_UP_FAILED, { 
          error_stage: 'password_set',
          error_type: 'exception',
        });
        setErrors({ form: 'Something went wrong. Please try again later.' });
        return;
      }

      // Track password set successfully
      Analytics.track(AUTH_EVENTS.SIGN_UP_PASSWORD_SET);

      // Sign in the user after account creation
      const digits = phone.replace(/\D/g, '');
      const email = `${digits}@settle.phone`;

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // Account created but couldn't auto-sign in, redirect to sign-in
        Analytics.track(AUTH_EVENTS.SIGN_UP_COMPLETED, { 
          auto_sign_in: false,
          signup_method: 'phone_otp',
        });
        router.replace('/(auth)/sign-in');
        return;
      }

      // Claim shadow account if exists
      try {
        await supabase.rpc('complete_signup', {
          p_phone: phone,
          p_name: name,
        });
      } catch (claimError) {
        console.error('[SetPassword] Claim account error:', claimError);
        // Continue anyway, user is signed in
      }

      // Get the user ID for identification
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        // Identify the new user in analytics
        Analytics.identify(userData.user.id, {
          phone: phone,
          name: name,
          created_at: userData.user.created_at,
        });
        
        // Set properties that should only be set once
        Analytics.setUserPropertiesOnce({
          first_seen_at: new Date().toISOString(),
          signup_platform: Platform.OS,
          signup_method: 'phone_otp',
        });
      }

      // Track sign up completed
      Analytics.track(AUTH_EVENTS.SIGN_UP_COMPLETED, { 
        auto_sign_in: true,
        signup_method: 'phone_otp',
      });

      // Navigate to main app
      router.replace('/(tabs)');
    } catch (err) {
      console.error('[SetPassword] Exception:', err);
      setErrors({ form: 'Something went wrong. Please try again later.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const textColor = isDark ? colors.text.dark.primary : colors.text.light.primary;
  const secondaryTextColor = isDark ? colors.text.dark.secondary : colors.text.light.secondary;
  const backgroundColor = isDark ? colors.background.dark : colors.background.light;

  // Password strength indicator
  const getPasswordStrength = () => {
    if (!password) return { level: 0, label: '', color: colors.gray[400] };

    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return { level: 1, label: 'Weak', color: colors.error };
    if (strength <= 3) return { level: 2, label: 'Medium', color: colors.warning };
    return { level: 3, label: 'Strong', color: colors.success };
  };

  const passwordStrength = getPasswordStrength();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back Button */}
          <MotiView
            from={{ opacity: 0, translateX: -20 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={{ type: 'timing', duration: 300 }}
          >
            <Pressable onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={textColor} />
            </Pressable>
          </MotiView>

          {/* Header */}
          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            style={styles.header}
          >
            <MotiView
              from={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 15, delay: 200 }}
              style={[styles.iconContainer, { backgroundColor: colors.primary[100] }]}
            >
              <Ionicons name="lock-closed-outline" size={40} color={colors.primary[500]} />
            </MotiView>
            <MotiText
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 500, delay: 300 }}
              style={[styles.title, { color: textColor }]}
            >
              Create Password
            </MotiText>
            <MotiText
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 500, delay: 400 }}
              style={[styles.subtitle, { color: secondaryTextColor }]}
            >
              Secure your account with a strong password
            </MotiText>
          </MotiView>

          {/* Step Indicator */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 500, delay: 350 }}
            style={styles.stepIndicator}
          >
            <View style={[styles.stepDot, styles.stepDotCompleted]} />
            <View style={[styles.stepLine, { backgroundColor: colors.success }]} />
            <View style={[styles.stepDot, styles.stepDotCompleted]} />
            <View style={[styles.stepLine, { backgroundColor: colors.primary[500] }]} />
            <View style={[styles.stepDot, styles.stepDotActive]} />
          </MotiView>
          <Text style={[styles.stepText, { color: secondaryTextColor }]}>
            Step 3 of 3: Secure Your Account
          </Text>

          {/* Form */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 500 }}
            style={styles.form}
          >
            {/* Form Error */}
            {errors.form && (
              <MotiView
                from={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={styles.formError}
              >
                <Ionicons name="alert-circle" size={20} color={colors.error} />
                <Text style={styles.formErrorText}>{errors.form}</Text>
              </MotiView>
            )}

            {/* Password Input */}
            <Input
              label="Password"
              placeholder="Create a strong password"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
              leftIcon={
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={isDark ? colors.gray[400] : colors.gray[500]}
                />
              }
              rightIcon={
                <Pressable onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={isDark ? colors.gray[400] : colors.gray[500]}
                  />
                </Pressable>
              }
            />

            {/* Password Strength */}
            {password.length > 0 && (
              <MotiView
                from={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                style={styles.strengthContainer}
              >
                <View style={styles.strengthBars}>
                  {[1, 2, 3].map((level) => (
                    <View
                      key={level}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            passwordStrength.level >= level
                              ? passwordStrength.color
                              : isDark
                                ? colors.gray[700]
                                : colors.gray[200],
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                  {passwordStrength.label}
                </Text>
              </MotiView>
            )}

            {/* Confirm Password Input */}
            <Input
              ref={confirmPasswordRef}
              label="Confirm Password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleCreateAccount}
              leftIcon={
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={isDark ? colors.gray[400] : colors.gray[500]}
                />
              }
              rightIcon={
                confirmPassword && password === confirmPassword ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                ) : null
              }
            />

            {/* Requirements */}
            <View style={styles.requirements}>
              <Text style={[styles.requirementsTitle, { color: secondaryTextColor }]}>
                Password must have:
              </Text>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={password.length >= 6 ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={password.length >= 6 ? colors.success : secondaryTextColor}
                />
                <Text
                  style={[
                    styles.requirementText,
                    { color: password.length >= 6 ? colors.success : secondaryTextColor },
                  ]}
                >
                  At least 6 characters
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={/[A-Za-z]/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={/[A-Za-z]/.test(password) ? colors.success : secondaryTextColor}
                />
                <Text
                  style={[
                    styles.requirementText,
                    { color: /[A-Za-z]/.test(password) ? colors.success : secondaryTextColor },
                  ]}
                >
                  At least one letter
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={/[0-9]/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={/[0-9]/.test(password) ? colors.success : secondaryTextColor}
                />
                <Text
                  style={[
                    styles.requirementText,
                    { color: /[0-9]/.test(password) ? colors.success : secondaryTextColor },
                  ]}
                >
                  At least one number
                </Text>
              </View>
            </View>

            {/* Create Account Button */}
            <Button
              title="Create Account"
              onPress={handleCreateAccount}
              loading={isLoading}
              style={styles.button}
            />
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
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stepDotActive: {
    backgroundColor: colors.primary[500],
  },
  stepDotCompleted: {
    backgroundColor: colors.success,
  },
  stepLine: {
    width: 40,
    height: 2,
    marginHorizontal: 4,
  },
  stepText: {
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 32,
  },
  form: {
    flex: 1,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.error}15`,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  formErrorText: {
    color: colors.error,
    marginLeft: 8,
    flex: 1,
  },
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 16,
  },
  strengthBars: {
    flexDirection: 'row',
    flex: 1,
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 12,
    width: 60,
    textAlign: 'right',
  },
  requirements: {
    marginBottom: 24,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  requirementText: {
    fontSize: 13,
    marginLeft: 8,
  },
  button: {
    marginTop: 8,
  },
});
