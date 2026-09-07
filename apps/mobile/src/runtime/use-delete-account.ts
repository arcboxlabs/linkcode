import { deleteAccount, runAccountDeletionTeardown } from '@mobile/runtime/cloud/deletion';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';

export interface DeleteAccountState {
  busy: boolean;
  confirmDelete: () => void;
}

/** Shared deletion flow for both platform account screens. Confirmation is an RN `Alert`
 * because that already is the native alert on iOS and Android. */
export function useDeleteAccount(): DeleteAccountState {
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
      if (outcome.kind === 'unknown') {
        Alert.alert(t('deleteUnknown'));
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

  return { busy, confirmDelete };
}
