import { useCloudAccount } from '@mobile/runtime/cloud/account';
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
} from '@mobile/runtime/notifications';
import { useSettingsStore } from '@mobile/stores/settings-store';
import { useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslations } from 'use-intl';

export function useNotificationSettings() {
  const t = useTranslations('mobile.settings');
  const account = useCloudAccount();
  const enabled = useSettingsStore((state) => state.notificationsEnabled);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const update = async (enabled: boolean) => {
    if (account.status !== 'signed-in' || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      if (!enabled) {
        await disableDeviceNotifications();
        return;
      }
      if (await enableDeviceNotifications(account.user.id)) return;
      Alert.alert(t('notificationsDeniedTitle'), t('notificationsDenied'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('openSettings'),
          onPress() {
            void Linking.openSettings();
          },
        },
      ]);
    } catch {
      Alert.alert(t('notificationsErrorTitle'), t('notificationsError'));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return { enabled, canUpdate: account.status === 'signed-in' && !pending, update };
}
