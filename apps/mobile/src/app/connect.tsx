import { EmptyState, ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { Button, Card, Input, Label, ListGroup, Spinner, TextField } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useHqAccount } from '../runtime/hq/account';
import { ensureDeviceRegistered } from '../runtime/hq/devices';
import type { OnlineHost } from '../runtime/hq/hosts';
import { fetchOnlineHosts } from '../runtime/hq/hosts';
import { HostUrlSchema, useHostRegistryStore } from '../stores/host-store';

/**
 * Machine list & host registry. Signed in, the account's online machines are
 * the main body and manual URL entry collapses into an advanced fallback;
 * signed out, a sign-in card leads and the manual form stays open as the
 * primary path.
 */
export default function ConnectScreen() {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const account = useHqAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const removeHost = useHostRegistryStore((state) => state.removeHost);
  const [manualOpen, setManualOpen] = useState(false);

  const signedIn = account.status === 'signed-in';

  return (
    <ScreenScroll title={t('title')} keyboardAware>
      {account.status === 'signed-in' ? (
        <MyMachinesSection userId={account.user.id} />
      ) : account.status === 'signed-out' ? (
        <SignInCard />
      ) : null}

      {hosts.length === 0 ? (
        signedIn ? null : (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        )
      ) : (
        <View className="gap-2">
          <SectionLabel>{t('savedHosts')}</SectionLabel>
          <ListGroup>
            {hosts.map((host) => (
              <ListGroup.Item key={host.id} onPress={() => router.push(`/host/${host.id}`)}>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{host.name}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {'url' in host ? host.url : t('viaTunnel')}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <Button variant="danger-soft" size="sm" onPress={() => removeHost(host.id)}>
                    <Button.Label>{t('remove')}</Button.Label>
                  </Button>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            ))}
          </ListGroup>
        </View>
      )}

      {signedIn && !manualOpen ? (
        <Button variant="ghost" onPress={() => setManualOpen(true)}>
          <Button.Label>{t('addManually')}</Button.Label>
        </Button>
      ) : (
        <ManualHostForm />
      )}
    </ScreenScroll>
  );
}

function SectionLabel({ children }: React.PropsWithChildren) {
  return (
    <Text
      className="text-[11px] text-muted"
      style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
    >
      {children}
    </Text>
  );
}

/**
 * The account's online machines (daemons connected to the relay) — tapping
 * one saves it as a tunnel host and opens it.
 */
function MyMachinesSection({ userId }: { userId: string }) {
  const t = useTranslations('mobile.connect.hq');
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
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('machines')}</SectionLabel>
        <Button variant="ghost" size="sm" onPress={refresh}>
          <Button.Label>{t('refresh')}</Button.Label>
        </Button>
      </View>
      {hostsError ? (
        <Text className="text-[13px] text-danger">{t('error')}</Text>
      ) : onlineHosts === null ? (
        <View className="items-start py-2">
          <Spinner />
        </View>
      ) : onlineHosts.length === 0 ? (
        <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
          {t('empty')}
        </Text>
      ) : (
        <ListGroup>
          {onlineHosts.map((host) => (
            <ListGroup.Item key={host.hostId} onPress={() => openHost(host)}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{host.name ?? host.hostId.slice(0, 8)}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{t('title')}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </View>
  );
}

/** Signed-out lead-in: the account is how machines appear here. */
function SignInCard() {
  const t = useTranslations('mobile.connect.hq');
  const router = useRouter();
  return (
    <Card>
      <Card.Body className="gap-3">
        <Text className="text-[15px] text-foreground" style={{ fontWeight: '500' }}>
          {t('title')}
        </Text>
        <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
          {t('hint')}
        </Text>
        <Button onPress={() => router.push('/sign-in')}>
          <Button.Label>{t('signIn')}</Button.Label>
        </Button>
      </Card.Body>
    </Card>
  );
}

/** Manual host entry: add a daemon by URL and open it. */
function ManualHostForm() {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const addHost = useHostRegistryStore((state) => state.addHost);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [urlInvalid, setUrlInvalid] = useState(false);

  const submit = () => {
    const trimmedUrl = url.trim();
    if (!HostUrlSchema.safeParse(trimmedUrl).success) {
      setUrlInvalid(true);
      return;
    }
    const profile = addHost({ name: name.trim() || t('namePlaceholder'), url: trimmedUrl });
    setName('');
    setUrl('');
    setUrlInvalid(false);
    router.push(`/host/${profile.id}`);
  };

  return (
    <Card>
      <Card.Body className="gap-4">
        <TextField>
          <Label>{t('nameLabel')}</Label>
          <Input
            value={name}
            onChangeText={setName}
            placeholder={t('namePlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </TextField>
        <TextField>
          <Label>{t('urlLabel')}</Label>
          <Input
            value={url}
            onChangeText={(next) => {
              setUrl(next);
              setUrlInvalid(false);
            }}
            placeholder={t('urlPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            isInvalid={urlInvalid}
          />
          {urlInvalid ? <Text className="text-[12px] text-danger">{t('invalidUrl')}</Text> : null}
        </TextField>
        <Button onPress={submit}>
          <Button.Label>{t('add')}</Button.Label>
        </Button>
      </Card.Body>
    </Card>
  );
}
