import {
  ensureDeviceRegistered,
  registerDevicePushToken,
  revokeDevicePushToken,
} from '@mobile/runtime/cloud/devices';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { DevicePushToken } from 'expo-notifications';
import * as Notifications from 'expo-notifications';

export const NOTIFICATION_CHANNEL_ID = 'session-events';

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

export async function requestNotificationPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Session events',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (permissionGranted(current)) return true;
  if (!current.canAskAgain) return false;
  return permissionGranted(await Notifications.requestPermissionsAsync());
}

export async function syncDevicePushToken(
  userId: string,
  devicePushToken?: DevicePushToken,
): Promise<void> {
  if (!Device.isDevice) throw new Error('push notifications require a physical device');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('Expo project ID is missing');
  }
  await ensureDeviceRegistered(userId);
  const expoPushToken = await Notifications.getExpoPushTokenAsync({
    projectId,
    devicePushToken,
  });
  await registerDevicePushToken(expoPushToken.data);
}

export { revokeDevicePushToken };
