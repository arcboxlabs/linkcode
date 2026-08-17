import {
  Column,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { FormList } from '@mobile/components/form/list.android';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { ToggleRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import {
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_SERVICE_URL,
  THEME_LABEL_KEY,
  THEME_PREFERENCES,
} from '@mobile/components/settings/settings-screen.shared';
import { LARGE_TITLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
} from '@mobile/runtime/notifications';
import { setMobileProductAnalyticsEnabled } from '@mobile/runtime/product-analytics';
import { useAnalyticsPreferenceStore } from '@mobile/stores/analytics-store';
import { useSettingsStore } from '@mobile/stores/settings-store';
import { Stack, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Compose has no `Link` row, so legal rows open the URL through RN `Linking`. */
function openUrl(url: string): void {
  Linking.openURL(url).catch(noop);
}

/** Android settings, mirroring the SwiftUI screen in `settings-screen.ios.tsx`: same sections,
 * MD3 dress. */
export function SettingsScreen(): React.ReactNode {
  const t = useTranslations('mobile.settings');
  const tAbout = useTranslations('mobile.about');
  const router = useRouter();
  const account = useCloudAccount();
  const productAnalyticsEnabled = useAnalyticsPreferenceStore((state) => state.enabled);
  const themePreference = useSettingsStore((state) => state.themePreference);
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);
  const keepHostsConnected = useSettingsStore((state) => state.keepHostsConnected);
  const setKeepHostsConnected = useSettingsStore((state) => state.setKeepHostsConnected);
  const [notificationUpdatePending, setNotificationUpdatePending] = useState(false);
  const notificationUpdatePendingRef = useRef(false);
  const notificationsToggleEnabled =
    account.status === 'signed-in' && !notificationUpdatePending;

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

  return (
    <View className="flex-1">
      <Stack.Screen
        options={{
          ...LARGE_TITLE_HEADER_OPTIONS,
          title: t('title'),
        }}
      />
      <FormList>
        <FormSection>
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
        </FormSection>

        <FormSection title={t('connections')} footer={t('keepHostsConnectedHint')}>
          <ToggleRow
            label={t('keepHostsConnected')}
            value={keepHostsConnected}
            onValueChange={setKeepHostsConnected}
          />
        </FormSection>

        <FormSection title={t('appearance')}>
          <SingleChoiceSegmentedButtonRow modifiers={[padding(16, 6, 16, 10), fillMaxWidth()]}>
            {THEME_PREFERENCES.map((preference) => (
              <SegmentedButton
                key={preference}
                selected={themePreference === preference}
                onClick={() => setThemePreference(preference)}
              >
                <SegmentedButton.Label>
                  <Text>{t(THEME_LABEL_KEY[preference])}</Text>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
        </FormSection>

        <FormSection title={t('privacy')} footer={t('analyticsHint')}>
          <ToggleRow
            label={t('analytics')}
            value={productAnalyticsEnabled}
            onValueChange={setMobileProductAnalyticsEnabled}
          />
        </FormSection>

        <FormSection
          title={t('notifications')}
          footer={
            account.status === 'signed-in'
              ? t('notificationsHint')
              : t('notificationsRequiresCloud')
          }
        >
          <ToggleRow
            label={t('notifications')}
            value={notificationsEnabled}
            onValueChange={(enabled) => {
              if (!notificationsToggleEnabled) return;
              void updateNotifications(enabled);
            }}
          />
        </FormSection>

        <FormSection title={t('legalAndSupport')}>
          <NavigationRow title={t('privacyPolicy')} onPress={() => openUrl(PRIVACY_POLICY_URL)} />
          <NavigationRow
            title={t('termsOfService')}
            onPress={() => openUrl(TERMS_OF_SERVICE_URL)}
          />
          <NavigationRow title={t('support')} onPress={() => openUrl(SUPPORT_URL)} />
        </FormSection>

        <FormSection title={t('about')}>
          <AboutBlock
            title={tAbout('title')}
            contract={tAbout('contract', { version: WIRE_PROTOCOL_VERSION })}
          />
        </FormSection>

        <FormSection title={tAbout('registeredAgents')} footer={tAbout('note')}>
          {AgentKindSchema.options.map((kind) => (
            <Text key={kind} modifiers={[padding(16, 10, 16, 10)]}>
              {kind}
            </Text>
          ))}
        </FormSection>
      </FormList>
    </View>
  );
}

function AboutBlock({ title, contract }: { title: string; contract: string }): React.ReactNode {
  const colors = useMaterialColors();

  return (
    <Column verticalArrangement={{ spacedBy: 4 }} modifiers={[padding(16, 8, 16, 8)]}>
      <Text style={{ typography: 'titleMedium' }}>{title}</Text>
      <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
        {contract}
      </Text>
    </Column>
  );
}
