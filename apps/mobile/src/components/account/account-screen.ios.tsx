import { Button, Form, Host, ProgressView, Section } from '@expo/ui/swift-ui';
import { DevicesSection } from '@mobile/components/account/devices-section';
import { ProfileRow } from '@mobile/components/account/profile-row';
import { signOutOfCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { useTranslations } from 'use-intl';

/** Account body: profile, the account's device registry, and sign-out. The route shell owns the
 * signed-out redirect; a transient non-signed-in status renders as loading. */
export function AccountScreen(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  return (
    // Form needs the viewport as its proposed size, otherwise it collapses to its content.
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        {account.status !== 'signed-in' ? (
          <ProgressView />
        ) : (
          <>
            <Section>
              <ProfileRow user={account.user} />
            </Section>
            <DevicesSection />
            <Section>
              <Button
                role="destructive"
                label={t('signOut')}
                onPress={() => {
                  void signOutOfCloud();
                }}
              />
            </Section>
          </>
        )}
      </Form>
    </Host>
  );
}
