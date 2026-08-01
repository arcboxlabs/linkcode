import {
  Button,
  DisclosureGroup,
  Form,
  Host,
  HStack,
  ProgressView,
  Section,
  Spacer,
  SwipeActions,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  buttonStyle,
  font,
  foregroundStyle,
  keyboardType,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { NavigationRow } from '@mobile/components/form-row';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { ensureDeviceRegistered } from '@mobile/runtime/cloud/devices';
import type { OnlineHost } from '@mobile/runtime/cloud/hosts';
import { fetchOnlineHosts } from '@mobile/runtime/cloud/hosts';
import { HostUrlSchema, useHostRegistryStore } from '@mobile/stores/host-store';
import { Stack, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const FOOTNOTE = font({ textStyle: 'footnote' });

/**
 * Machine list & host registry. Signed in, online machines lead and manual URL entry
 * collapses into a disclosure row; signed out, a sign-in section leads and the form stays open.
 */
export default function ConnectScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const account = useCloudAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);

  const signedIn = account.status === 'signed-in';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerLargeTitle: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {account.status === 'signed-in' ? (
            <MyMachinesSection userId={account.user.id} />
          ) : account.status === 'signed-out' ? (
            <SignInSection />
          ) : null}

          {hosts.length > 0 ? <SavedHostsSection /> : null}

          {/* Signed out there is nothing else to connect with, so the form opens itself. */}
          <ManualHostSection startsExpanded={!signedIn} />
        </Form>
      </Host>
    </>
  );
}

/** Online machines (daemons connected to the relay) — tapping one saves it as a tunnel host and opens it. */
function MyMachinesSection({ userId }: { userId: string }) {
  const t = useTranslations('mobile.connect.cloud');
  const router = useRouter();
  const addTunnelHost = useHostRegistryStore((state) => state.addTunnelHost);

  const [onlineHosts, setOnlineHosts] = useState<OnlineHost[] | null>(null);
  const [hostsError, setHostsError] = useState(false);

  const load = useCallback(() => {
    fetchOnlineHosts()
      .then(setOnlineHosts)
      .catch(() => setHostsError(true));
  }, []);

  const refresh = () => {
    setHostsError(false);
    setOnlineHosts(null);
    load();
  };

  useEffect(() => {
    // Best-effort: registration only lists the phone under the account's
    // devices; discovering and connecting to hosts does not depend on it.
    ensureDeviceRegistered(userId).catch(noop);
    load();
  }, [userId, load]);

  const openHost = (host: OnlineHost) => {
    const profile = addTunnelHost({
      name: host.name ?? host.hostId.slice(0, 8),
      tunnelHostId: host.hostId,
    });
    router.push(`/host/${profile.id}`);
  };

  return (
    // A titled Section can't also carry an action, so the header is drawn by hand —
    // footnote + secondary is what SwiftUI gives a plain `title` on iOS.
    <Section
      header={
        <HStack>
          <Text modifiers={[FOOTNOTE, SECONDARY]}>{t('machines')}</Text>
          <Spacer />
          <Button
            label={t('refresh')}
            onPress={refresh}
            modifiers={[buttonStyle('plain'), FOOTNOTE]}
          />
        </HStack>
      }
    >
      {hostsError ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('error')}</Text>
      ) : onlineHosts === null ? (
        <ProgressView />
      ) : onlineHosts.length === 0 ? (
        <Text modifiers={[SECONDARY]}>{t('empty')}</Text>
      ) : (
        onlineHosts.map((host) => (
          <NavigationRow
            key={host.hostId}
            title={host.name ?? host.hostId.slice(0, 8)}
            subtitle={t('title')}
            onPress={() => openHost(host)}
          />
        ))
      )}
    </Section>
  );
}

/** Signed-out lead-in: the account is how machines appear here. */
function SignInSection(): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const router = useRouter();
  return (
    <Section title={t('title')} footer={<Text>{t('hint')}</Text>}>
      <Button label={t('signIn')} onPress={() => router.push('/sign-in')} />
    </Section>
  );
}

/** Saved hosts, direct or tunnelled. Removal is the list's own swipe action rather than a
 *  row button, so the row itself stays a single tap target for opening the host. */
function SavedHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const removeHost = useHostRegistryStore((state) => state.removeHost);

  return (
    <Section title={t('savedHosts')}>
      {hosts.map((host) => (
        <SwipeActions key={host.id}>
          <SwipeActions.Actions>
            <Button role="destructive" label={t('remove')} onPress={() => removeHost(host.id)} />
          </SwipeActions.Actions>
          <NavigationRow
            title={host.name}
            subtitle={'url' in host ? host.url : t('viaTunnel')}
            onPress={() => router.push(`/host/${host.id}`)}
          />
        </SwipeActions>
      ))}
    </Section>
  );
}

/** Manual host entry: add a daemon by URL and open it. */
function ManualHostSection({ startsExpanded }: { startsExpanded: boolean }): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const addHost = useHostRegistryStore((state) => state.addHost);

  // Null until the user decides either way. Seeding `useState` from `startsExpanded` would freeze
  // the value taken during the account's `loading` render, leaving a signed-in user's form open.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [urlInvalid, setUrlInvalid] = useState(false);
  // The fields are backed by native state rather than mirrored into React: `get()` reads what
  // the field itself holds, so submitting never depends on a change event reaching JS first.
  const name = useNativeState('');
  const url = useNativeState('');

  const submit = () => {
    const trimmedUrl = url.get().trim();
    if (!HostUrlSchema.safeParse(trimmedUrl).success) {
      setUrlInvalid(true);
      return;
    }
    const profile = addHost({ name: name.get().trim() || t('namePlaceholder'), url: trimmedUrl });
    name.set('');
    url.set('');
    setUrlInvalid(false);
    router.push(`/host/${profile.id}`);
  };

  return (
    <Section footer={<Text>{urlInvalid ? t('invalidUrl') : t('emptyHint')}</Text>}>
      <DisclosureGroup
        label={t('addManually')}
        isExpanded={expanded ?? startsExpanded}
        onIsExpandedChange={setExpanded}
      >
        {/* `LabeledContent` sizes the field to its text, leaving the rest of the row
            untappable; an HStack lets the field take the remaining width. */}
        <HStack spacing={12}>
          <Text>{t('nameLabel')}</Text>
          <TextField
            testID="host-name-input"
            text={name}
            placeholder={t('namePlaceholder')}
            modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
          />
        </HStack>
        <HStack spacing={12}>
          <Text>{t('urlLabel')}</Text>
          <TextField
            testID="host-url-input"
            text={url}
            placeholder={t('urlPlaceholder')}
            onTextChange={() => setUrlInvalid(false)}
            modifiers={[
              textInputAutocapitalization('never'),
              autocorrectionDisabled(),
              keyboardType('url'),
              textContentType('URL'),
              // The URL is the only required field, so the return key finishes the form.
              submitLabel('go'),
              onSubmit(submit),
            ]}
          />
        </HStack>
        <Button label={t('add')} onPress={submit} />
      </DisclosureGroup>
    </Section>
  );
}
