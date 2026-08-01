import { Form, Host } from '@expo/ui/swift-ui';
import { ManualHostSection } from '@mobile/components/connect/manual-host-section';
import { MyMachinesSection } from '@mobile/components/connect/my-machines-section';
import { SavedHostsSection } from '@mobile/components/connect/saved-hosts-section';
import { SignInSection } from '@mobile/components/connect/sign-in-section';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

/**
 * Machine list & host registry. Signed in, online machines lead and manual URL entry
 * collapses into a disclosure row; signed out, a sign-in section leads and the form stays open.
 */
export default function ConnectScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const account = useCloudAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);

  const signedIn = account.status === 'signed-in';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerLargeTitle: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {account.status === 'signed-in' ? (
            <MyMachinesSection userId={account.user.id} />
          ) : account.status === 'signed-out' ? (
            <SignInSection />
          ) : null}

          {hosts.length > 0 ? <SavedHostsSection /> : null}

          {/* Signed out there is nothing else to connect with, so the form opens itself. */}
          <ManualHostSection startsExpanded={!signedIn} />
        </Form>
      </Host>
    </>
  );
}
