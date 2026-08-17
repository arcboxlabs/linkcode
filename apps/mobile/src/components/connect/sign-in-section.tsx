import { Button, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { FormSection } from '@mobile/components/form/section.android';
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Signed-out lead-in: the account is how machines appear on the connect screen. */
export function SignInSection(): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const router = useRouter();

  return (
    <FormSection title={t('title')} footer={t('hint')}>
      <Button
        onClick={() => router.push('/sign-in')}
        modifiers={[padding(16, 4, 16, 4), fillMaxWidth()]}
      >
        <Text>{t('signIn')}</Text>
      </Button>
    </FormSection>
  );
}
