import { ListItem, Text } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { DevicesSection } from '@mobile/components/account/devices-section';
import { ProfileRow } from '@mobile/components/account/profile-row';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { FormList } from '@mobile/components/form/list.android';
import { FormLoadingRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { signOutOfCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import { useTranslations } from 'use-intl';

/** Android account body, mirroring `account-screen.ios.tsx`. Sign-out is a plain error-colored
 * row — MD3's shape for a destructive entry in a settings list. */
export function AccountScreen(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const colors = useAppMaterialColors();
  const account = useCloudAccount();

  return (
    <FormList>
      {account.status !== 'signed-in' ? (
        <FormLoadingRow />
      ) : (
        <>
          <FormSection>
            <ProfileRow user={account.user} />
          </FormSection>
          <DevicesSection />
          <FormSection>
            <ListItem
              modifiers={[
                clickable(() => {
                  void signOutOfCloud();
                }),
              ]}
            >
              <ListItem.HeadlineContent>
                <Text color={colors.error}>{t('signOut')}</Text>
              </ListItem.HeadlineContent>
            </ListItem>
          </FormSection>
        </>
      )}
    </FormList>
  );
}
