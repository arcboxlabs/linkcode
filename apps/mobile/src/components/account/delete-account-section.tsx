import { Button, Section } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { deleteAccount, runAccountDeletionTeardown } from '@mobile/runtime/cloud/deletion';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';

/**
 * Permanent, in-app account deletion (App Store Guideline 5.1.1(v)). Its own
 * Section, below Sign out, `Button role="destructive"` — not hidden behind
 * any secondary menu, matching `DevicesSection`'s destructive-row precedent.
 */
export function DeleteAccountSection(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const [busy, setBusy] = useState(false);

  const failureMessage = (code: string | undefined): string => {
    if (code === 'ACCOUNT_DELETION_EMERGENCY_AUDIT_HOLD') return t('deleteEmergencyHold');
    if (code === 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER') return t('deleteSoleOwner');
    return t('deleteFailed');
  };

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await deleteAccount();
      if (outcome.kind === 'reauthentication-failed') {
        Alert.alert(t('deleteReauthenticationFailed'));
        return;
      }
      if (outcome.kind === 'apple-device-required') {
        Alert.alert(t('deleteAppleDeviceRequired'));
        return;
      }
      if (outcome.kind === 'account-mismatch') {
        Alert.alert(t('deleteAccountMismatch'));
        return;
      }
      if (outcome.kind === 'failed') {
        Alert.alert(failureMessage(outcome.code));
        return;
      }

      // Both remaining outcomes (`pending` and `completed`) mean the server
      // already accepted the deletion — local teardown runs regardless.
      await runAccountDeletionTeardown();
      if (outcome.kind === 'pending') {
        Alert.alert(t('deletePending'));
        return;
      }
      // A failed revocation still leaves deletion successful and needs manual Apple follow-up.
      if (outcome.authorizationRevocation === 'failed') {
        Alert.alert(t('deleteRevocationFailedTitle'), t('deleteRevocationFailedMessage'));
      } else {
        Alert.alert(t('deleteCompleted'));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('deleteTitle'), t('deleteMessage'), [
      { text: t('deleteCancel'), style: 'cancel' },
      {
        text: t('deleteConfirm'),
        style: 'destructive',
        onPress() {
          void run();
        },
      },
    ]);
  };

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
