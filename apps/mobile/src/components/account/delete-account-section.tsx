import { ListItem, Text } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useDeleteAccount } from '@mobile/runtime/use-delete-account';
import { useTranslations } from 'use-intl';

/** Android delete row. Compose has no button `role`, so the label uses the error color. */
export function DeleteAccountSection(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const colors = useAppMaterialColors();
  const { busy, confirmDelete } = useDeleteAccount();

  return (
    <FormSection>
      <ListItem
        modifiers={[
          clickable(() => {
            if (!busy) confirmDelete();
          }),
        ]}
      >
        <ListItem.HeadlineContent>
          <Text color={colors.error}>{t('deleteAccount')}</Text>
        </ListItem.HeadlineContent>
      </ListItem>
    </FormSection>
  );
}
