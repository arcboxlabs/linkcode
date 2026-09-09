import { ActionButton } from '@mobile/components/form/action-button';
import { AppLoadingScreen } from '@mobile/components/shell/app-loading-screen';
import { BrandMark } from '@mobile/components/shell/brand-mark';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { signInToCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { isAppleSignInCancel, signInWithApple } from '@mobile/runtime/cloud/idp';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  content: {
    gap: 48,
    maxWidth: 420,
    width: '100%',
  },
  hero: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: Platform.OS === 'ios' ? 34 : 32,
    fontWeight: Platform.OS === 'ios' ? '700' : '400',
    lineHeight: Platform.OS === 'ios' ? 41 : 40,
  },
  tagline: {
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    lineHeight: Platform.OS === 'ios' ? 22 : 24,
    maxWidth: 320,
  },
  actions: {
    gap: 12,
  },
  status: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 18,
  },
  error: {
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    lineHeight: Platform.OS === 'ios' ? 18 : 16,
  },
  appleButton: {
    height: 50,
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
});

/**
 * First-run welcome: native Apple sign-in when available, browser OAuth otherwise,
 * or skip to manual host setup. Signed-in visitors bounce to the machine list.
 */
export default function SignInScreen() {
  const t = useTranslations('mobile.signIn');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const palette = useNativePalette();
  const account = useCloudAccount();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(null);

  useEffect((signal) => {
    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (!signal.aborted) setAppleAvailable(available);
      })
      .catch(() => {
        if (!signal.aborted) setAppleAvailable(false);
      });
  }, []);

  if (account.status === 'signed-in') return <Redirect href="/connect" />;
  if (appleAvailable === null || account.status === 'loading') {
    return <AppLoadingScreen />;
  }

  const run = async (flow: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await flow();
    } catch (error) {
      if (!isAppleSignInCancel(error)) {
        setFailed(true);
        AccessibilityInfo.announceForAccessibility(t('error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: palette.background }}
      // Safe areas are padded in here rather than via UIKit inset adjustment: adjusted insets
      // extend a flexGrow container past the viewport, leaving a scroll range on a fitting screen.
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
      // Fits-on-screen content must not drag; overflow (large accessibility type) still scrolls.
      alwaysBounceVertical={false}
    >
      <View style={styles.content}>
        <View style={styles.hero}>
          <BrandMark size={80} />
          <Text
            accessibilityRole="header"
            dynamicTypeRamp="largeTitle"
            style={[styles.title, { color: palette.text }]}
          >
            LinkCode
          </Text>
          <Text
            className="text-center"
            dynamicTypeRamp="body"
            style={[styles.tagline, { color: palette.textSecondary }]}
          >
            {t('tagline')}
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.status}>
            {busy ? (
              <ActivityIndicator
                accessibilityRole="progressbar"
                color={palette.tint}
                size="small"
              />
            ) : failed ? (
              <Text
                accessibilityRole="alert"
                className="text-center"
                dynamicTypeRamp="footnote"
                selectable
                style={[styles.error, { color: palette.danger }]}
              >
                {t('error')}
              </Text>
            ) : null}
          </View>

          {appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              accessibilityState={{ disabled: busy, busy }}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                colorScheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={13}
              pointerEvents={busy ? 'none' : 'auto'}
              style={[styles.appleButton, busy && styles.disabled]}
              onPress={() => {
                if (!busy) void run(signInWithApple);
              }}
            />
          ) : null}
          <ActionButton
            fullWidth
            disabled={busy}
            variant={appleAvailable ? 'secondary' : 'primary'}
            label={appleAvailable ? t('other') : t('signIn')}
            onPress={() => {
              void run(signInToCloud);
            }}
          />
          <ActionButton
            fullWidth
            disabled={busy}
            variant="text"
            label={t('skip')}
            onPress={() => router.push('/connect')}
          />
        </View>
      </View>
    </ScrollView>
  );
}
