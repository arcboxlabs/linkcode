import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { resolveNotificationRoute } from '@mobile/runtime/notification-route';
import { syncDevicePushToken } from '@mobile/runtime/notifications';
import { useHostRegistryHydrated, useHostRegistryStore } from '@mobile/stores/host-store';
import { useSettingsStore } from '@mobile/stores/settings-store';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

export function NotificationObserver(): null {
  const router = useRouter();
  const account = useCloudAccount();
  const hydrated = useHostRegistryHydrated();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const enabled = useSettingsStore((state) => state.notificationsEnabled);
  const userId = account.status === 'signed-in' ? account.user.id : null;

  useEffect(() => {
    if (!hydrated) return;

    const open = (response: Notifications.NotificationResponse) => {
      const route = resolveNotificationRoute(response.notification.request.content.data, hosts);
      if (route) router.push(route);
    };

    const initial = Notifications.getLastNotificationResponse();
    if (initial) {
      open(initial);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [hosts, hydrated, router]);

  useEffect(() => {
    if (!enabled || !userId) return;

    const sync = (devicePushToken?: Notifications.DevicePushToken) => {
      syncDevicePushToken(userId, devicePushToken).catch((error: unknown) =>
        Sentry.captureException(error),
      );
    };

    sync();
    const tokenSubscription = Notifications.addPushTokenListener(sync);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [enabled, userId]);

  return null;
}
