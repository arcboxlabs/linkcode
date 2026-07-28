import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { sanitizeSentryTransaction } from '@linkcode/common/sentry';
import type { TelemetryConfig } from '@linkcode/common/telemetry-config';
import { DEFAULT_TELEMETRY_CONFIG, fetchTelemetryConfig } from '@linkcode/common/telemetry-config';
import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import * as Sentry from '@sentry/react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useNavigationContainerRef } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { useSingleton } from 'foxact/use-singleton';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppIntlProvider, AppThemeProvider } from '../components/app-providers';
import { RootNavigator } from '../components/navigation';
import { MobileProductAnalyticsProvider } from '../components/product-analytics-provider';
import '../global.css';

// The DSN is a publishable identifier (not a secret); Expo inlines EXPO_PUBLIC_* env vars at build time.
// With no DSN the SDK no-ops, so local dev reports nothing unless EXPO_PUBLIC_SENTRY_DSN is set.
const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});
let mobileTraceSampleRate = DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate.mobile;
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: sentryDsn,
  integrations: [
    Sentry.reactNativeTracingIntegration({
      traceFetch: false,
      traceXHR: false,
      enableHTTPTimings: false,
    }),
    navigationIntegration,
  ],
  beforeSendTransaction: (event) =>
    sanitizeSentryTransaction(event, {
      fallbackTransactionName: 'mobile navigation',
      safeTransactionNames: ['mobile navigation'],
      safeSpanNames: ['<Root>'],
    }),
  sendDefaultPii: false,
  tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(mobileTraceSampleRate),
});
if (sentryDsn) void fetchTelemetryConfig(expoFetch).then(applyTelemetryConfig);

/**
 * Root layout. global.css is imported here so Uniwind styles apply to every route;
 * GestureHandlerRootView must wrap the whole tree.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Sentry.wrap is the documented expo-router root HOC; Metro Fast Refresh still handles the wrapped component.
function RootLayout() {
  const { current: locale } = useSingleton(getRuntimeLocale);
  const messages = useMemo(() => getMessages(locale), [locale]);
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    navigationIntegration.registerNavigationContainer(navigationRef);
  }, [navigationRef]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ComposeContextProvider
        contexts={[
          <SafeAreaProvider key="safe-area" />,
          <AppThemeProvider key="theme" />,
          <AppIntlProvider key="intl" locale={locale} messages={messages} />,
          <BottomSheetModalProvider key="bottom-sheet" />,
          <MobileProductAnalyticsProvider key="product-analytics" />,
        ]}
      >
        <StatusBar style="auto" />
        <RootNavigator />
      </ComposeContextProvider>
    </GestureHandlerRootView>
  );
}

function getRuntimeLocale() {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
}

function applyTelemetryConfig(config: TelemetryConfig | null): void {
  if (config) mobileTraceSampleRate = config.sentry.tracesSampleRate.mobile;
}

// Sentry.wrap enables native crash tracking + performance/touch tracking on the root component.
export default Sentry.wrap(RootLayout);
