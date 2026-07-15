import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { useSingleton } from 'foxact/use-singleton';
import { HeroUINativeProvider } from 'heroui-native';
import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ThemeController } from '../components/theme-controller';
import '../global.css';

// The DSN is a publishable identifier (not a secret); Expo inlines EXPO_PUBLIC_* env vars at build time.
// With no DSN the SDK no-ops, so local dev reports nothing unless EXPO_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
});

/**
 * Root layout: gesture root, safe-area + HeroUI providers, app-wide IntlProvider, and
 * the expo-router navigator. Uniwind's compiled global.css is imported here so it
 * applies to every route. GestureHandlerRootView must wrap the whole tree.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Sentry.wrap is the documented expo-router root HOC; Metro Fast Refresh still handles the wrapped component.
function RootLayout() {
  const { current: locale } = useSingleton(getRuntimeLocale);
  const messages = useMemo(() => getMessages(locale), [locale]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ComposeContextProvider
        contexts={[
          <SafeAreaProvider key="safe-area" />,
          // ComposeContextProvider clones each element with real children; the explicit null
          // only satisfies providers whose props make `children` required.
          <HeroUINativeProvider key="heroui">{null}</HeroUINativeProvider>,
          <IntlProvider key="intl" locale={locale} messages={messages}>
            {null}
          </IntlProvider>,
          <BottomSheetModalProvider key="bottom-sheet" />,
        ]}
      >
        <ThemeController />
        <Stack screenOptions={{ headerShown: false }} />
      </ComposeContextProvider>
    </GestureHandlerRootView>
  );
}

function getRuntimeLocale() {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
}

// Sentry.wrap enables native crash tracking + performance/touch tracking on the root component.
export default Sentry.wrap(RootLayout);
