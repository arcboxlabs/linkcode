import { Button, Section } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { deleteAccount, runAccountDeletionTeardown } from '@mobile/runtime/cloud/deletion';
import * as AppleAuthentication from 'expo-apple-authentication';
import { noop } from 'foxact/noop';
import { useEffect, useState } from 'react';
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
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(noop);
  }, []);

  const failureMessage = (code: string | undefined): string => {
    if (code === 'ACCOUNT_DELETION_EMERGENCY_AUDIT_HOLD') return t('deleteEmergencyHold');
    if (code === 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER') return t('deleteSoleOwner');
    return t('deleteFailed');
  };

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await deleteAccount({ isAppleAvailable: appleAvailable });
      if (outcome.kind === 'reauthentication-failed') {
        Alert.alert(t('deleteReauthenticationFailed'));
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
      // Success never says "contact support" — a failed revocation is still
      // a successful deletion, just with a manual Apple follow-up
      // (design.md §3.4, TN3194).
      if (outcome.siwaRevocation === 'failed') {
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
          // Deliberately no retry affordance — the server is idempotent on
          // replay, but a client-side retry button would invite repeating
          // an operation that may have already fully succeeded.
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
