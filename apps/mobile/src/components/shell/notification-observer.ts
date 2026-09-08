import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { resolveNotificationRoute } from '@mobile/runtime/notification-route';
import { activateNotificationSync, syncDevicePushToken } from '@mobile/runtime/notifications';
import { useHostRegistryHydrated, useHostRegistryStore } from '@mobile/stores/host-store';
import { useSettingsStore } from '@mobile/stores/settings-store';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

export function NotificationObserver(): null {
  const router = useRouter();
  const account = useCloudAccount();
  const hydrated = useHostRegistryHydrated();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);
  const enabled = useSettingsStore((state) => state.notificationsEnabled);
  const userId = account.status === 'signed-in' ? account.user.id : null;

  const openNotification = useEffectEvent((response: Notifications.NotificationResponse) => {
    try {
      const target = resolveNotificationRoute(response.notification.request.content.data, hosts);
      if (target?.type === 'session') {
        setLastActiveHostId(target.hostId);
        router.push({
          pathname: '/session/[sessionId]',
          params: { sessionId: target.sessionId },
        });
      } else if (target?.type === 'connect') {
        router.push('/connect');
      }
    } finally {
      Notifications.clearLastNotificationResponse();
    }
  });

  useEffect(() => {
    if (!hydrated) return;

    const initial = Notifications.getLastNotificationResponse();
    if (initial) openNotification(initial);
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => subscription.remove();
  }, [hydrated]);

  useEffect(() => {
    if (!enabled || !userId) return;

    const deactivate = activateNotificationSync(userId);
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
      deactivate();
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [enabled, userId]);

  return null;
}
