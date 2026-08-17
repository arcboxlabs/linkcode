import { ConnectScreen } from '@mobile/components/connect/connect-screen';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

export default function ConnectRoute(): React.ReactNode {
  const t = useTranslations('mobile.connect');

  return (
    <>
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title: t('title'),
        }}
      />
      <ConnectScreen />
    </>
  );
}
