import { Redirect, useRouter } from 'expo-router';
import { Button, Spinner } from 'heroui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { BrandMark } from '../components/brand-mark';
import { signInToCloud, useCloudAccount } from '../runtime/cloud/account';

/**
 * First-run welcome: sign in through LinkCode Cloud, or skip to manual host
 * setup. Signed-in visitors bounce straight to the machine list.
 */
export default function SignInScreen() {
  const t = useTranslations('mobile.signIn');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const account = useCloudAccount();
  const [busy, setBusy] = useState(false);

  if (account.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background">
        <BrandMark />
        <Spinner />
      </View>
    );
  }
  if (account.status === 'signed-in') return <Redirect href="/connect" />;

  const signIn = async () => {
    setBusy(true);
    try {
      await signInToCloud();
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
        <Button
          size="lg"
          isDisabled={busy}
          onPress={() => {
            void signIn();
          }}
        >
          <Button.Label>{t('signIn')}</Button.Label>
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/connect')}>
          <Button.Label>{t('skip')}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
