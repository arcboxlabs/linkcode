import { signOutOfCloud } from '@mobile/runtime/cloud/account';
import type { CloudDevice } from '@mobile/runtime/cloud/devices';
import { fetchDevices, getEnrolledDeviceId, revokeDevice } from '@mobile/runtime/cloud/devices';
import { formatRelativeShort } from '@mobile/utils/relative-time';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';

export interface DevicesSectionState {
  devices: CloudDevice[] | null;
  devicesError: boolean;
  enrolledId: string | null;
  busyId: string | null;
  refresh: () => void;
  confirmRevoke: (device: CloudDevice) => void;
  describeDevice: (device: CloudDevice) => string;
}

/** View-model of the account's device registry, shared by both platform views. Revoking cuts
 * access to new tunnel tokens; revoking this phone also signs it out (the cloud kills its
 * sessions). Confirmation stays an RN `Alert` — that already is the native alert on both. */
export function useDevicesSection(): DevicesSectionState {
  const t = useTranslations('mobile.account');

  const [devices, setDevices] = useState<CloudDevice[] | null>(null);
  const [devicesError, setDevicesError] = useState(false);
  const [enrolledId, setEnrolledId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDevices()
      .then(setDevices)
      .catch(() => setDevicesError(true));
  }, []);

  useEffect(() => {
    getEnrolledDeviceId().then(setEnrolledId).catch(noop);
    load();
  }, [load]);

  const refresh = () => {
    setDevicesError(false);
    setDevices(null);
    load();
  };

  const revoke = async (device: CloudDevice) => {
    setBusyId(device.id);
    try {
      await revokeDevice(device.id);
      if (device.id === enrolledId) {
        // The device revoke already removed its push token and killed this phone's sessions.
        await signOutOfCloud({ revokePushToken: false }).catch(noop);
        return;
      }
      refresh();
    } catch {
      Alert.alert(t('revokeError'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRevoke = (device: CloudDevice) => {
    Alert.alert(
      t('revokeTitle', { name: device.name }),
      device.id === enrolledId ? t('revokeThisDeviceMessage') : t('revokeMessage'),
      [
        { text: t('revokeCancel'), style: 'cancel' },
        {
          text: t('revoke'),
          style: 'destructive',
          onPress() {
            void revoke(device);
          },
        },
      ],
    );
  };

  const describeDevice = (device: CloudDevice): string => {
    const kind = t(`deviceKind.${device.kind}`);
    const platform = device.platform ? `${kind} · ${device.platform}` : kind;
    return device.lastSeenAt
      ? `${platform} · ${t('lastSeen', { time: formatRelativeShort(new Date(device.lastSeenAt).getTime()) })}`
      : platform;
  };

  return { devices, devicesError, enrolledId, busyId, refresh, confirmRevoke, describeDevice };
}
