import { BrandMark } from '@mobile/components/shell/brand-mark';
import { signInToCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { isAppleSignInCancel, signInWithApple } from '@mobile/runtime/cloud/idp';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Color, Redirect, useRouter } from 'expo-router';
import { useEffect } from 'foxact/use-abortable-effect';
import { Button } from 'heroui-native';
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

const iosColors = {
  accent: Platform.OS === 'ios' ? Color.ios.systemBlue : undefined,
};

const iosStyles = StyleSheet.create({
  screen: Platform.OS === 'ios' ? { backgroundColor: Color.ios.systemBackground } : {},
  label: Platform.OS === 'ios' ? { color: Color.ios.label } : {},
  secondaryLabel: Platform.OS === 'ios' ? { color: Color.ios.secondaryLabel } : {},
  danger: Platform.OS === 'ios' ? { color: Color.ios.systemRed } : {},
  primaryButton: Platform.OS === 'ios' ? { backgroundColor: Color.ios.systemBlue } : {},
  primaryButtonLabel: Platform.OS === 'ios' ? { color: 'white' } : {},
  secondaryButton: Platform.OS === 'ios' ? { backgroundColor: Color.ios.secondarySystemFill } : {},
  accentLabel: Platform.OS === 'ios' ? { color: Color.ios.systemBlue } : {},
});

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
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 41,
  },
  tagline: {
    fontSize: 17,
    lineHeight: 22,
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
    fontSize: 13,
    lineHeight: 18,
  },
  appleButton: {
    height: 50,
    width: '100%',
  },
  authButton: {
    borderRadius: 13,
    height: 'auto',
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  manualButton: {
    borderRadius: 13,
    height: 'auto',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonLabel: {
    fontSize: 17,
    lineHeight: 22,
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
    return (
      <View
        className="flex-1 items-center justify-center gap-6 bg-background"
        style={iosStyles.screen}
      >
        <BrandMark size={80} />
        <ActivityIndicator accessibilityRole="progressbar" color={iosColors.accent} />
      </View>
    );
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
      className="flex-1 bg-background"
      style={iosStyles.screen}
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
            className="font-bold text-foreground"
            dynamicTypeRamp="largeTitle"
            style={[styles.title, iosStyles.label]}
          >
            LinkCode
          </Text>
          <Text
            className="text-center text-muted"
            dynamicTypeRamp="body"
            style={[styles.tagline, iosStyles.secondaryLabel]}
          >
            {t('tagline')}
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.status}>
            {busy ? (
              <ActivityIndicator
                accessibilityRole="progressbar"
                color={iosColors.accent}
                size="small"
              />
            ) : failed ? (
              <Text
                accessibilityRole="alert"
                className="text-center text-danger"
                dynamicTypeRamp="footnote"
                selectable
                style={[styles.error, iosStyles.danger]}
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
          <Button
            animation={{ scale: false }}
            isDisabled={busy}
            size="md"
            style={[
              styles.authButton,
              appleAvailable ? iosStyles.secondaryButton : iosStyles.primaryButton,
            ]}
            variant={appleAvailable ? 'secondary' : 'primary'}
            onPress={() => {
              void run(signInToCloud);
            }}
          >
            <Button.Label
              dynamicTypeRamp="body"
              style={[
                styles.buttonLabel,
                appleAvailable ? iosStyles.label : iosStyles.primaryButtonLabel,
              ]}
            >
              {appleAvailable ? t('other') : t('signIn')}
            </Button.Label>
          </Button>
          <Button
            animation={{ scale: false }}
            style={styles.manualButton}
            variant="ghost"
            onPress={() => router.push('/connect')}
          >
            <Button.Label
              dynamicTypeRamp="body"
              style={[styles.buttonLabel, iosStyles.accentLabel]}
            >
              {t('skip')}
            </Button.Label>
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
