import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  Link,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import { buttonStyle, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { Stack, useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';
import { useCloudAccount } from '../runtime/cloud/account';
import { setMobileProductAnalyticsEnabled } from '../runtime/product-analytics';
import { useAnalyticsPreferenceStore } from '../stores/analytics-store';

const PRIVACY_POLICY_URL = 'https://linkcode.ai/privacy';
const TERMS_OF_SERVICE_URL = 'https://linkcode.ai/terms';
const SUPPORT_URL = 'https://linkcode.ai/support';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });

/** A form row that pushes a route. SwiftUI draws the disclosure chevron from
 *  `NavigationLink`, which `@expo/ui` does not expose, so the row draws its own. */
function NavigationRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    // `plain` keeps the row in the label colour; a Form's default button style tints it accent.
    <Button onPress={onPress} modifiers={[buttonStyle('plain')]}>
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={2}>
          <Text>{title}</Text>
          {subtitle ? (
            <Text modifiers={[font({ textStyle: 'footnote' }), SECONDARY]}>{subtitle}</Text>
          ) : null}
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" size={13} modifiers={[TERTIARY]} />
      </HStack>
    </Button>
  );
}

/** App settings: account + host management entries plus the About/contract summary. */
export default function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const account = useCloudAccount();
  const productAnalyticsEnabled = useAnalyticsPreferenceStore((state) => state.enabled);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerLargeTitle: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section>
            {account.status === 'signed-in' ? (
              <NavigationRow
                title={account.user.name || account.user.email}
                subtitle={account.user.email}
                onPress={() => router.push('/account')}
              />
            ) : account.status === 'signed-out' ? (
              <NavigationRow title={t('signIn')} onPress={() => router.push('/sign-in')} />
            ) : null}
            <NavigationRow title={t('manageHosts')} onPress={() => router.push('/connect')} />
            <NavigationRow
              title={t('terminalAppearance')}
              onPress={() => router.push('/terminal-appearance')}
            />
          </Section>

          <Section title={t('privacy')} footer={<Text>{t('analyticsHint')}</Text>}>
            <Toggle
              isOn={productAnalyticsEnabled}
              onIsOnChange={setMobileProductAnalyticsEnabled}
              label={t('analytics')}
            />
          </Section>

          {/* Native links open the URL themselves — no Linking.openURL fallback to get wrong. */}
          <Section title={t('legalAndSupport')}>
            <Link label={t('privacyPolicy')} destination={PRIVACY_POLICY_URL} />
            <Link label={t('termsOfService')} destination={TERMS_OF_SERVICE_URL} />
            <Link label={t('support')} destination={SUPPORT_URL} />
          </Section>

          <Section title={t('about')}>
            <VStack alignment="leading" spacing={4}>
              <Text modifiers={[font({ textStyle: 'headline' })]}>{tAbout('title')}</Text>
              <Text modifiers={[font({ textStyle: 'footnote' }), SECONDARY]}>
                {tAbout('contract', { version: WIRE_PROTOCOL_VERSION })}
              </Text>
            </VStack>
          </Section>

          <Section
            title={tAbout('registeredAgents')}
            footer={
              <Text modifiers={[font({ textStyle: 'footnote' }), SECONDARY]}>{tAbout('note')}</Text>
            }
          >
            {AgentKindSchema.options.map((kind) => (
              <Text key={kind}>{kind}</Text>
            ))}
          </Section>
        </Form>
      </Host>
    </>
  );
}
