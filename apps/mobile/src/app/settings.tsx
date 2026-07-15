import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome, ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
import { Button, Card, Chip, ListGroup } from 'heroui-native';
import { useTranslations } from 'use-intl';
import { useCloudAccount } from '../runtime/cloud/account';
import type { ThemePreference } from '../stores/settings-store';
import { useSettingsStore } from '../stores/settings-store';

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const THEME_LABEL_KEY = {
  system: 'appearanceSystem',
  light: 'appearanceLight',
  dark: 'appearanceDark',
} as const;

/** App settings: account + host management, appearance, and the About/contract summary. */
export default function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const account = useCloudAccount();
  const themePreference = useSettingsStore((state) => state.themePreference);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);

  return (
    <ScreenScroll title={t('title')}>
      <ListGroup>
        {account.status === 'signed-in' ? (
          <ListGroup.Item onPress={() => router.push('/account')}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{account.user.name || account.user.email}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{account.user.email}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        ) : account.status === 'signed-out' ? (
          <ListGroup.Item onPress={() => router.push('/sign-in')}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{t('signIn')}</ListGroup.ItemTitle>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        ) : null}
        <ListGroup.Item onPress={() => router.push('/connect')}>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{t('manageHosts')}</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
        <ListGroup.Item>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{t('appearance')}</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            {THEME_PREFERENCES.map((preference) => (
              <Chip
                key={preference}
                variant={themePreference === preference ? 'primary' : 'soft'}
                size="sm"
                color={themePreference === preference ? 'accent' : 'default'}
                onPress={() => setThemePreference(preference)}
              >
                <Chip.Label>{t(THEME_LABEL_KEY[preference])}</Chip.Label>
              </Chip>
            ))}
          </ListGroup.ItemSuffix>
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
