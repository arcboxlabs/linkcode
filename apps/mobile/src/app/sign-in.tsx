import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { Button, Spinner } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { BrandMark } from '../components/brand-mark';
import { signInToCloud, useCloudAccount } from '../runtime/cloud/account';
import { isAppleSignInCancel, signInWithApple } from '../runtime/cloud/idp';

/**
 * First-run welcome: native Sign in with Apple when the platform offers it,
 * the browser OAuth flow for everything else, or skip to manual host setup.
 * Signed-in visitors bounce straight to the machine list.
 */
export default function SignInScreen() {
  const t = useTranslations('mobile.signIn');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const account = useCloudAccount();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(noop);
  }, []);

  if (account.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background">
        <BrandMark />
        <Spinner />
      </View>
    );
  }
  if (account.status === 'signed-in') return <Redirect href="/connect" />;

  const run = async (flow: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await flow();
    } catch (error) {
      if (!isAppleSignInCancel(error)) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <View className="flex-1 items-center justify-center gap-4">
        <BrandMark />
        <Text className="text-[34px] text-foreground" style={{ fontWeight: '700' }}>
          LinkCode
        </Text>
        <Text
          className="text-center text-[15px] text-muted"
          style={{ lineHeight: 22, maxWidth: 300 }}
        >
          {t('tagline')}
        </Text>
      </View>
      <View className="gap-3">
        {failed ? <Text className="text-center text-[13px] text-danger">{t('error')}</Text> : null}
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              colorScheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={26}
            style={{ height: 52, opacity: busy ? 0.5 : 1 }}
            onPress={() => {
              if (!busy) void run(signInWithApple);
            }}
          />
        ) : null}
        <Button
          size="lg"
          variant={appleAvailable ? 'secondary' : 'primary'}
          isDisabled={busy}
          onPress={() => {
            void run(signInToCloud);
          }}
        >
          <Button.Label>{appleAvailable ? t('other') : t('signIn')}</Button.Label>
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/connect')}>
          <Button.Label>{t('skip')}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
