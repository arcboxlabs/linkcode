import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome, ScreenScroll, SectionLabel } from '@linkcode/ui/native';
import { Stack, useRouter } from 'expo-router';
import { Card, ListGroup, useThemeColor } from 'heroui-native';
import { ChevronRightIcon } from 'lucide-react-native';
import { Alert, Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useCloudAccount } from '../runtime/cloud/account';

const PRIVACY_POLICY_URL = 'https://linkcode.ai/privacy';
const TERMS_OF_SERVICE_URL = 'https://linkcode.ai/terms';
const SUPPORT_URL = 'https://linkcode.ai/support';

/** App settings: account + host management entries plus the About/contract summary. */
export default function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const account = useCloudAccount();
  const muted = useThemeColor('muted');
  const chevron = <ChevronRightIcon size={16} color={muted} />;

  function openExternalUrl(url: string): void {
    void Linking.openURL(url).catch(() => Alert.alert(t('externalLinkError')));
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerLargeTitle: true, title: t('title') }} />
      <ScreenScroll>
        <ListGroup>
          {account.status === 'signed-in' ? (
            <ListGroup.Item onPress={() => router.push('/account')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{account.user.name || account.user.email}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{account.user.email}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
            </ListGroup.Item>
          ) : account.status === 'signed-out' ? (
            <ListGroup.Item onPress={() => router.push('/sign-in')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{t('signIn')}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
            </ListGroup.Item>
          ) : null}
          <ListGroup.Item onPress={() => router.push('/connect')}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{t('manageHosts')}</ListGroup.ItemTitle>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
          </ListGroup.Item>
          <ListGroup.Item onPress={() => router.push('/terminal-appearance')}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{t('terminalAppearance')}</ListGroup.ItemTitle>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
          </ListGroup.Item>
        </ListGroup>

        <View className="gap-2">
          <SectionLabel>{t('legalAndSupport')}</SectionLabel>
          <ListGroup>
            <ListGroup.Item
              accessibilityLabel={t('privacyPolicy')}
              accessibilityRole="link"
              onPress={() => openExternalUrl(PRIVACY_POLICY_URL)}
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{t('privacyPolicy')}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
            </ListGroup.Item>
            <ListGroup.Item
              accessibilityLabel={t('termsOfService')}
              accessibilityRole="link"
              onPress={() => openExternalUrl(TERMS_OF_SERVICE_URL)}
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{t('termsOfService')}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
            </ListGroup.Item>
            <ListGroup.Item
              accessibilityLabel={t('support')}
              accessibilityRole="link"
              onPress={() => openExternalUrl(SUPPORT_URL)}
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{t('support')}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{chevron}</ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
        </View>

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
      </ScreenScroll>
    </>
  );
}
