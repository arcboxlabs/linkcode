import { Form, Host, Link, Picker, Section, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { disabled, font, foregroundStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { useHostMenuItems } from '@mobile/components/host/use-host-menu-items';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
} from '@mobile/runtime/notifications';
import { setMobileProductAnalyticsEnabled } from '@mobile/runtime/product-analytics';
import { useAnalyticsPreferenceStore } from '@mobile/stores/analytics-store';
import type { ThemePreference } from '@mobile/stores/settings-store';
import { useSettingsStore } from '@mobile/stores/settings-store';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const THEME_LABEL_KEY = {
  system: 'appearanceSystem',
  light: 'appearanceLight',
  dark: 'appearanceDark',
} as const;

const PRIVACY_POLICY_URL = 'https://linkcode.ai/privacy';
const TERMS_OF_SERVICE_URL = 'https://linkcode.ai/terms';
const SUPPORT_URL = 'https://linkcode.ai/support';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** App settings: account + host management entries plus the About/contract summary. Nothing here is
 * host-scoped, and the tab is deliberately ungated — this is where "Manage hosts" lives, so it has
 * to survive the selected host being unreachable. */
export function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const account = useCloudAccount();
  const hostMenuItems = useHostMenuItems();
  const productAnalyticsEnabled = useAnalyticsPreferenceStore((state) => state.enabled);
  const themePreference = useSettingsStore((state) => state.themePreference);
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);
  const keepHostsConnected = useSettingsStore((state) => state.keepHostsConnected);
  const setKeepHostsConnected = useSettingsStore((state) => state.setKeepHostsConnected);
  const [notificationUpdatePending, setNotificationUpdatePending] = useState(false);
  const notificationUpdatePendingRef = useRef(false);

  const updateNotifications = async (enabled: boolean) => {
    if (account.status !== 'signed-in' || notificationUpdatePendingRef.current) return;
    notificationUpdatePendingRef.current = true;
    setNotificationUpdatePending(true);
    try {
      if (!enabled) {
        await disableDeviceNotifications();
        return;
      }
      if (await enableDeviceNotifications(account.user.id)) return;
      Alert.alert(t('notificationsDeniedTitle'), t('notificationsDenied'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('openSettings'),
          onPress() {
            void Linking.openSettings();
          },
        },
      ]);
    } catch {
      Alert.alert(t('notificationsErrorTitle'), t('notificationsError'));
    } finally {
      notificationUpdatePendingRef.current = false;
      setNotificationUpdatePending(false);
    }
  };

  // The flex container is load-bearing: a SwiftUI host left as the screen's direct child is
  // proposed the whole window and paints straight over the large title.
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          headerLargeTitle: true,
          title: t('title'),
          unstable_headerLeftItems: () => hostMenuItems,
        }}
      />
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

          <Section title={t('connections')} footer={<Text>{t('keepHostsConnectedHint')}</Text>}>
            <Toggle
              isOn={keepHostsConnected}
              onIsOnChange={setKeepHostsConnected}
              label={t('keepHostsConnected')}
            />
          </Section>

          <Section title={t('appearance')}>
            <Picker
              selection={themePreference}
              onSelectionChange={setThemePreference}
              modifiers={[pickerStyle('segmented')]}
            >
              {THEME_PREFERENCES.map((preference) => (
                <Text key={preference} modifiers={[tag(preference)]}>
                  {t(THEME_LABEL_KEY[preference])}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title={t('privacy')} footer={<Text>{t('analyticsHint')}</Text>}>
            <Toggle
              isOn={productAnalyticsEnabled}
              onIsOnChange={setMobileProductAnalyticsEnabled}
              label={t('analytics')}
            />
          </Section>

          <Section
            title={t('notifications')}
            footer={
              <Text>
                {account.status === 'signed-in'
                  ? t('notificationsHint')
                  : t('notificationsRequiresCloud')}
              </Text>
            }
          >
            <Toggle
              isOn={notificationsEnabled}
              onIsOnChange={updateNotifications}
              label={t('notifications')}
              modifiers={[disabled(account.status !== 'signed-in' || notificationUpdatePending)]}
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
    </View>
  );
}
