import { EmptyState, ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { Button, Card, Input, Label, ListGroup, Spinner, TextField } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { OnlineHost } from '../runtime/hq';
import {
  ensureDeviceRegistered,
  fetchOnlineHosts,
  hqAuthClient,
  signInToHq,
  signOutOfHq,
} from '../runtime/hq';
import { HostUrlSchema, useHostRegistryStore } from '../stores/host-store';

/**
 * Host registry screen: lists saved hosts and adds new ones by URL. This is also the
 * future slot for tunnel login/discovery (M3) — pairing flows land here without
 * touching the startup redirect or host-scoped screens.
 */
export default function ConnectScreen() {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const addHost = useHostRegistryStore((state) => state.addHost);
  const removeHost = useHostRegistryStore((state) => state.removeHost);

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
    <ScreenScroll title={t('title')} keyboardAware>
      <HqAccountSection />


      {hosts.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <View className="gap-2">
          <Text
            className="text-[11px] text-muted"
            style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
          >
            {t('savedHosts')}
          </Text>
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
    </ScreenScroll>
  );
}

/**
 * The HQ account block: sign in through the central IdP, then list the
 * account's online machines (daemons connected to the relay) — tapping one
 * saves it as a tunnel host and opens it.
 */
function HqAccountSection(): React.ReactNode {
  const t = useTranslations('mobile.connect.hq');
  const router = useRouter();
  const addTunnelHost = useHostRegistryStore((state) => state.addTunnelHost);
  const { data: session, isPending } = hqAuthClient.useSession();
  const signedIn = Boolean(session);

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
    if (!signedIn) return;
    // Best-effort: registration only lists the phone under the account's
    // devices; discovering and connecting to hosts does not depend on it.
    ensureDeviceRegistered().catch(noop);
    load();
  }, [signedIn, load]);

  const openHost = (host: OnlineHost) => {
    const profile = addTunnelHost({
      name: host.name ?? host.hostId.slice(0, 8),
      tunnelHostId: host.hostId,
    });
    router.push(`/host/${profile.id}`);
  };

  if (isPending) return null;

  if (!signedIn) {
    return (
      <Card>
        <Card.Body className="gap-3">
          <Text className="text-[15px] text-foreground" style={{ fontWeight: '500' }}>
            {t('title')}
          </Text>
          <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
            {t('hint')}
          </Text>
          <Button
            onPress={() => {
              void signInToHq();
            }}
          >
            <Button.Label>{t('signIn')}</Button.Label>
          </Button>
        </Card.Body>
      </Card>
    );
  }

  return (
    <View className="gap-2">
      <Text
        className="text-[11px] text-muted"
        style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
      >
        {t('hosts')}
      </Text>
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
      <View className="flex-row items-center justify-between">
        <Text className="text-[12px] text-muted">
          {t('signedInAs', { name: session?.user.name ?? session?.user.email ?? '' })}
        </Text>
        <View className="flex-row gap-2">
          <Button variant="secondary" size="sm" onPress={refresh}>
            <Button.Label>{t('refresh')}</Button.Label>
          </Button>
          <Button
            variant="danger-soft"
            size="sm"
            onPress={() => {
              void signOutOfHq();
            }}
          >
            <Button.Label>{t('signOut')}</Button.Label>
          </Button>
        </View>
      </View>
    </View>
  );
}
