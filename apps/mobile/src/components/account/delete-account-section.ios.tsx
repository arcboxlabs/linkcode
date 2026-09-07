import { Button, Section } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { useDeleteAccount } from '@mobile/runtime/use-delete-account';
import { useTranslations } from 'use-intl';

/**
 * Permanent, in-app account deletion (App Store Guideline 5.1.1(v)). Its own
 * Section, below Sign out, `Button role="destructive"` — not hidden behind
 * any secondary menu, matching `DevicesSection`'s destructive-row precedent.
 */
export function DeleteAccountSection(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const { busy, confirmDelete } = useDeleteAccount();

  return (
    <Section>
      <Button
        role="destructive"
        label={t('deleteAccount')}
        onPress={confirmDelete}
        modifiers={[disabled(busy)]}
      />
    </Section>
  );
}
