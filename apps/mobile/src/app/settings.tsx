import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome, ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { Button, Card, ListGroup } from 'heroui-native';
import { useTranslations } from 'use-intl';

/** App settings: host management entry plus the About/contract summary. */
export default function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();

  return (
    <ScreenScroll title={t('title')}>
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
    </ScreenScroll>
  );
}
