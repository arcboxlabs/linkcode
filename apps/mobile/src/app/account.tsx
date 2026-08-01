import { Button, Form, Host, ProgressView, Section } from '@expo/ui/swift-ui';
import { DevicesSection } from '@mobile/components/account/devices-section';
import { ProfileRow } from '@mobile/components/account/profile-row';
import { signOutOfCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { Redirect, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Account screen: profile, the account's device registry, and sign-out. */
export default function AccountScreen(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  if (account.status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {account.status === 'loading' ? (
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
    </>
  );
}
