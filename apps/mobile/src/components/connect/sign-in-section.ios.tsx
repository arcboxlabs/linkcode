import { Button, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Signed-out lead-in: the account is how machines appear on the connect screen. */
export function SignInSection(): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const router = useRouter();
  return (
    <Section title={t('title')} footer={<Text>{t('hint')}</Text>}>
      <Button label={t('signIn')} onPress={() => router.push('/sign-in')} />
    </Section>
  );
}
