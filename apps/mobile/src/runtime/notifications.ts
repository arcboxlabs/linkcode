import {
  ensureDeviceRegistered,
  registerDevicePushToken,
  revokeDevicePushToken as revokeRegisteredDevicePushToken,
} from '@mobile/runtime/cloud/devices';
import { createNotificationTokenCoordinator } from '@mobile/runtime/notification-token-coordinator';
import { useSettingsStore } from '@mobile/stores/settings-store';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { DevicePushToken } from 'expo-notifications';
import * as Notifications from 'expo-notifications';

export const NOTIFICATION_CHANNEL_ID = 'session-events';

const tokenCoordinator = createNotificationTokenCoordinator();

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

function permissionGranted(settings: Notifications.NotificationPermissionsStatus): boolean {
  return (
    settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function ensureNotificationChannel(): Promise<void> {
  if (process.env.EXPO_OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Thread events',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }
}

async function requestNotificationPermission(): Promise<boolean> {
  await ensureNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (permissionGranted(current)) return true;
  if (!current.canAskAgain) return false;
  return permissionGranted(await Notifications.requestPermissionsAsync());
}

export async function syncDevicePushToken(
  userId: string,
  devicePushToken?: DevicePushToken,
): Promise<void> {
  await tokenCoordinator.sync(
    userId,
    async () => {
      if (!Device.isDevice) throw new Error('push notifications require a physical device');
      const projectId =
        Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (typeof projectId !== 'string' || !projectId) {
        throw new Error('Expo project ID is missing');
      }
      await ensureNotificationChannel();
      await ensureDeviceRegistered(userId);
      const expoPushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
        devicePushToken,
      });
      return expoPushToken.data;
    },
    registerDevicePushToken,
  );
}

export function activateNotificationSync(userId: string): () => void {
  const intent = tokenCoordinator.selectUser(userId);
  return () => {
    if (tokenCoordinator.isCurrent(intent)) tokenCoordinator.selectUser(null);
  };
}

export async function enableDeviceNotifications(userId: string): Promise<boolean> {
  if (!(await requestNotificationPermission())) return false;

  const intent = tokenCoordinator.selectUser(userId);
  const settings = useSettingsStore.getState();
  settings.setNotificationsEnabled(true);
  try {
    await syncDevicePushToken(userId);
    return true;
  } catch (error) {
    if (tokenCoordinator.isCurrent(intent)) {
      tokenCoordinator.selectUser(null);
      settings.setNotificationsEnabled(false);
    }
    throw error;
  }
}

export async function disableDeviceNotifications(
  options: { revokeToken?: boolean; rollbackOnFailure?: boolean } = {},
): Promise<void> {
  const settings = useSettingsStore.getState();
  const wasEnabled = settings.notificationsEnabled;
  const previousUserId = tokenCoordinator.getSelectedUser();
  const intent = tokenCoordinator.selectUser(null);
  settings.setNotificationsEnabled(false);
  if (!wasEnabled || options.revokeToken === false) return;

  try {
    await tokenCoordinator.revoke(revokeRegisteredDevicePushToken);
  } catch (error) {
    if (options.rollbackOnFailure !== false && tokenCoordinator.isCurrent(intent)) {
      tokenCoordinator.selectUser(previousUserId);
      settings.setNotificationsEnabled(true);
    }
    throw error;
  }
}
