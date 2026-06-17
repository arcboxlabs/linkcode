import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { IntlProvider, useTranslations } from 'use-intl';
import './global.css';

/**
 * Minimal mobile app, styled with NativeWind (Tailwind for React Native).
 * Reuses the single source-of-truth data contract from @linkcode/schema, proving the same
 * zod types are shared across platforms under Expo / Metro (PLAN §2.1 / §4.6).
 *
 * The HeroUI component library (PLAN ✅) builds on NativeWind; its remaining setup is in HEROUI_SETUP.md.
 */
export default function App() {
  const [locale] = useState(getRuntimeLocale);
  const messages = useMemo(() => getMessages(locale), [locale]);

  return (
    <IntlProvider locale={locale} messages={messages}>
      <MobileContent />
    </IntlProvider>
  );
}

function MobileContent() {
  const t = useTranslations('mobile');

  return (
    <View className="flex-1 bg-bg">
      <StatusBar style="light" />
      <ScrollView className="flex-1">
        <View className="gap-2 p-6 pt-16">
          <Text className="text-xl font-semibold text-text">{t('title')}</Text>
          <Text className="mb-4 text-[13px] text-muted">
            {t('contract', { version: WIRE_PROTOCOL_VERSION })}
          </Text>

          <Text className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('registeredAgents')}
          </Text>
          {AgentKindSchema.options.map((kind) => (
            <Text key={kind} className="text-[15px] text-text">
              • {kind}
            </Text>
          ))}

          <Text className="mt-6 text-[12px] leading-5 text-accent">{t('tunnel')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function getRuntimeLocale() {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}
