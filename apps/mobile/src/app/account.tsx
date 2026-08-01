import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import { badge, buttonStyle, disabled, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import type { CloudUser } from '@mobile/runtime/cloud/account';
import { signOutOfCloud, useCloudAccount } from '@mobile/runtime/cloud/account';
import type { CloudDevice } from '@mobile/runtime/cloud/devices';
import {
  clearDeviceEnrollment,
  fetchDevices,
  getEnrolledDeviceId,
  revokeDevice,
} from '@mobile/runtime/cloud/devices';
import { formatRelativeShort } from '@mobile/utils/relative-time';
import { Redirect, Stack } from 'expo-router';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const FOOTNOTE = font({ textStyle: 'footnote' });

/** Account screen: profile, the account's device registry, and sign-out. */
export default function AccountScreen(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const account = useCloudAccount();

  if (account.status === 'signed-out') return <Redirect href="/sign-in" />;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {account.status === 'loading' ? (
            <ProgressView />
          ) : (
            <>
              <Section>
                <ProfileRow user={account.user} />
              </Section>
              <DevicesSection />
              <Section>
                <Button
                  role="destructive"
                  label={t('signOut')}
                  onPress={() => {
                    void signOutOfCloud();
                  }}
                />
              </Section>
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

/** SF Symbol rather than the account's picture: `@expo/ui`'s `Image` takes SF Symbols, asset
 *  catalog names, and local files — never a remote URL. Apple sign-in supplies no picture
 *  anyway, so this is the fallback the old avatar already showed in the common case. */
function ProfileRow({ user }: { user: CloudUser }): React.ReactNode {
  return (
    <HStack spacing={12}>
      <Image systemName="person.crop.circle.fill" size={40} modifiers={[SECONDARY]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'headline' })]}>{user.name || user.email}</Text>
        <Text modifiers={[FOOTNOTE, SECONDARY]}>{user.email}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

/**
 * The account's registered devices. Revoking cuts access to new tunnel tokens;
 * revoking this phone also signs it out (the cloud kills its sessions).
 */
function DevicesSection() {
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
      ? `${platform} · ${t('lastSeen', { time: formatRelativeShort(new Date(device.lastSeenAt).getTime()) })}`
      : platform;
  };

  return (
    // A titled Section can't also carry an action, so the header is drawn by hand.
    <Section
      header={
        <HStack>
          <Text modifiers={[FOOTNOTE, SECONDARY]}>{t('devices')}</Text>
          <Spacer />
          <Button
            label={t('refresh')}
            onPress={refresh}
            modifiers={[buttonStyle('plain'), FOOTNOTE]}
          />
        </HStack>
      }
    >
      {devicesError ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('devicesError')}</Text>
      ) : devices === null ? (
        <ProgressView />
      ) : devices.length === 0 ? (
        <Text modifiers={[SECONDARY]}>{t('devicesEmpty')}</Text>
      ) : (
        devices.map((device) => (
          // Revoking is the row's swipe action, matching how saved hosts are removed. The
          // confirmation stays an RN `Alert` — that already is the native alert.
          <SwipeActions key={device.id}>
            <SwipeActions.Actions>
              <Button
                role="destructive"
                label={t('revoke')}
                onPress={() => confirmRevoke(device)}
                modifiers={[disabled(busyId !== null)]}
              />
            </SwipeActions.Actions>
            <VStack
              alignment="leading"
              spacing={2}
              modifiers={[device.id === enrolledId ? badge(t('thisDevice')) : badge()]}
            >
              <Text>{device.name}</Text>
              <Text modifiers={[FOOTNOTE, SECONDARY]}>{describeDevice(device)}</Text>
            </VStack>
          </SwipeActions>
        ))
      )}
    </Section>
  );
}
