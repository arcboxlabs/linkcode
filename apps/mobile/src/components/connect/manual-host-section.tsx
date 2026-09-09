import { Section } from '@expo/ui/swift-ui';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

export function ManualHostSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const router = useRouter();

  return (
    <Section>
      <NavigationRow title={t('addManually')} onPress={() => router.push('/add-host')} />
    </Section>
  );
}
