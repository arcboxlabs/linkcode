import { useRouter } from 'expo-router';
import { Button, Card, Input, Label, ListGroup, TextField } from 'heroui-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-[24px] text-foreground" style={{ fontWeight: '600' }}>
        {t('title')}
      </Text>

      {hosts.length === 0 ? (
        <View className="gap-1">
          <Text className="text-[15px] text-foreground" style={{ fontWeight: '500' }}>
            {t('emptyTitle')}
          </Text>
          <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
            {t('emptyHint')}
          </Text>
        </View>
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
    </ScrollView>
  );
}
