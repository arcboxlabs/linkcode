import { EmptyState, ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, Label, ListGroup, TextField } from 'heroui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
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
                  <ListGroup.ItemDescription>{host.url}</ListGroup.ItemDescription>
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
