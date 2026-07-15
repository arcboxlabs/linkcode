import { ScreenScroll } from '@linkcode/ui/native';
import { Redirect } from 'expo-router';
import { noop } from 'foxact/noop';
import { Avatar, Button, Card, Chip, ListGroup, Spinner } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import type { CloudUser } from '../runtime/cloud/account';
import { signOutOfCloud, useCloudAccount } from '../runtime/cloud/account';
import type { CloudDevice } from '../runtime/cloud/devices';
import {
  clearDeviceEnrollment,
  fetchDevices,
  getEnrolledDeviceId,
  revokeDevice,
} from '../runtime/cloud/devices';

/** Account screen: profile, the account's device registry, and sign-out. */
export default function AccountScreen() {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  if (account.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }
  if (account.status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <ScreenScroll title={t('title')}>
      <ProfileCard user={account.user} />
      <DevicesSection />
      <Button
        variant="danger-soft"
        onPress={() => {
          void signOutOfCloud();
        }}
      >
        <Button.Label>{t('signOut')}</Button.Label>
      </Button>
    </ScreenScroll>
  );
}

function ProfileCard({ user }: { user: CloudUser }) {
  return (
    <Card>
      <Card.Body className="flex-row items-center gap-4">
        <Avatar size="lg" alt={user.name}>
          {user.image ? <Avatar.Image source={{ uri: user.image }} /> : null}
          <Avatar.Fallback />
        </Avatar>
        <View className="flex-1 gap-1">
          <Text className="text-[17px] text-foreground" style={{ fontWeight: '600' }}>
            {user.name || user.email}
          </Text>
          <Text className="text-[13px] text-muted">{user.email}</Text>
        </View>
      </Card.Body>
    </Card>
  );
}

/**
 * The account's registered devices. Revoking cuts a device's access to new
 * tunnel tokens; revoking this phone also signs it out, since the cloud kills its
 * sessions with the device.
 */
function DevicesSection() {
  const t = useTranslations('mobile.account');
  const format = useFormatter();

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
        // The cloud already killed this phone's sessions along with the device; the
        // sign-out is local cookie/enrollment cleanup against a dead session.
        await clearDeviceEnrollment().catch(noop);
        await signOutOfCloud().catch(noop);
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
      ? `${platform} · ${t('lastSeen', { time: format.relativeTime(new Date(device.lastSeenAt)) })}`
      : platform;
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text
          className="text-[11px] text-muted"
          style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
        >
          {t('devices')}
        </Text>
        <Button variant="ghost" size="sm" onPress={refresh}>
          <Button.Label>{t('refresh')}</Button.Label>
        </Button>
      </View>
      {devicesError ? (
        <Text className="text-[13px] text-danger">{t('devicesError')}</Text>
      ) : devices === null ? (
        <View className="items-start py-2">
          <Spinner />
        </View>
      ) : devices.length === 0 ? (
        <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
          {t('devicesEmpty')}
        </Text>
      ) : (
        <ListGroup>
          {devices.map((device) => (
            <ListGroup.Item key={device.id}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{device.name}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{describeDevice(device)}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <View className="flex-row items-center gap-2">
                  {device.id === enrolledId ? (
                    <Chip size="sm" variant="soft">
                      <Chip.Label>{t('thisDevice')}</Chip.Label>
                    </Chip>
                  ) : null}
                  <Button
                    variant="danger-soft"
                    size="sm"
                    isDisabled={busyId !== null}
                    onPress={() => confirmRevoke(device)}
                  >
                    <Button.Label>{t('revoke')}</Button.Label>
                  </Button>
                </View>
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </View>
  );
}
