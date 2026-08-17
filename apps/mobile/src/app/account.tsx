import { AccountScreen } from '@mobile/components/account/account-screen';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { Redirect, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

export default function AccountRoute(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  if (account.status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <>
      <Stack.Screen options={{ ...VISIBLE_HEADER_OPTIONS, title: t('title') }} />
      <AccountScreen />
    </>
  );
}
