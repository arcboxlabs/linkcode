import { Button, Form, Host, Section } from '@expo/ui/swift-ui';
import { DeleteAccountSection } from '@mobile/components/account/delete-account-section';
import { DevicesSection } from '@mobile/components/account/devices-section';
import { ProfileRow } from '@mobile/components/account/profile-row';
import { LoadingView } from '@mobile/components/form/loading-view.ios';
import { signOutOfCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';

/** Account body: profile, the account's device registry, and sign-out. The route shell owns the
 * signed-out redirect; a transient non-signed-in status renders as loading. */
export function AccountScreen(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  return (
    // Form needs the viewport as its proposed size, otherwise it collapses to its content.
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      {account.status === 'signed-in' ? (
        <Form>
          <Section>
            <ProfileRow user={account.user} />
          </Section>
          <DevicesSection />
          <Section>
            <Button
              role="destructive"
              label={t('signOut')}
              onPress={() => {
                void signOutOfCloud().catch(() => Alert.alert(t('signOutError')));
              }}
            />
          </Section>
          <DeleteAccountSection />
        </Form>
      ) : (
        <LoadingView />
      )}
    </Host>
  );
}
