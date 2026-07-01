import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome } from '@linkcode/ui/native';
import { StatusBar } from 'expo-status-bar';
import { useSingleton } from 'foxact/use-singleton';
import { useMemo } from 'react';
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
  const { current: locale } = useSingleton(getRuntimeLocale);
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
    <MobileHome
      title={t('title')}
      contract={t('contract', { version: WIRE_PROTOCOL_VERSION })}
      registeredAgentsLabel={t('registeredAgents')}
      agentKinds={AgentKindSchema.options}
      tunnel={t('tunnel')}
      statusBar={<StatusBar style="light" />}
    />
  );
}

function getRuntimeLocale() {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
}
