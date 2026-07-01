import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { Button, Card, ListGroup } from 'heroui-native';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** App settings: host management entry plus the About/contract summary. */
export default function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
    >
      <Text className="text-[24px] text-foreground" style={{ fontWeight: '600' }}>
        {t('title')}
      </Text>

      <ListGroup>
        <ListGroup.Item onPress={() => router.push('/connect')}>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{t('manageHosts')}</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </ListGroup>

      <Card>
        <Card.Header>
          <Card.Title>{t('about')}</Card.Title>
        </Card.Header>
        <Card.Body>
          <MobileHome
            title={tAbout('title')}
            contract={tAbout('contract', { version: WIRE_PROTOCOL_VERSION })}
            registeredAgentsLabel={tAbout('registeredAgents')}
            agentKinds={AgentKindSchema.options}
            note={tAbout('note')}
          />
        </Card.Body>
      </Card>

      <Button variant="ghost" onPress={() => router.back()}>
        <Button.Label>{t('back')}</Button.Label>
      </Button>
    </ScrollView>
  );
}
