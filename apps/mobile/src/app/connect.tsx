import { Form, Host } from '@expo/ui/swift-ui';
import { ManualHostSection } from '@mobile/components/connect/manual-host-section';
import { MyMachinesSection } from '@mobile/components/connect/my-machines-section';
import { SavedHostsSection } from '@mobile/components/connect/saved-hosts-section';
import { SignInSection } from '@mobile/components/connect/sign-in-section';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

export default function ConnectScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const account = useCloudAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);

  return (
    <>
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title: t('title'),
        }}
      />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {account.status === 'signed-in' ? (
            <MyMachinesSection userId={account.user.id} />
          ) : account.status === 'signed-out' ? (
            <SignInSection />
          ) : null}

          {hosts.length > 0 ? <SavedHostsSection /> : null}

          <ManualHostSection />
        </Form>
      </Host>
    </>
  );
}
