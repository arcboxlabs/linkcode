import { sanitizeSentryTransaction } from '@linkcode/common/sentry';
import type { TelemetryConfig } from '@linkcode/common/telemetry-config';
import { DEFAULT_TELEMETRY_CONFIG, fetchTelemetryConfig } from '@linkcode/common/telemetry-config';
import { setKeyboardShortcutPlatform } from '@linkcode/ui';
import {
  initializeProductAnalytics,
  installAppearancePrefs,
  installNavigationPerformanceObserver,
} from '@linkcode/workbench';
import {
  browserTracingIntegration,
  getClient,
  init as sentryInit,
  setActiveSpanInBrowser,
  startBrowserTracingNavigationSpan,
  startInactiveSpan,
} from '@sentry/electron/renderer';
import { init as reactInit, withProfiler } from '@sentry/react';
import { createRoot } from 'react-dom/client';
import { DESKTOP_SPAN_NAMES, DESKTOP_TRANSACTION_NAMES } from '../../sentry-privacy';
import { DesktopApp } from './app';
import { systemBridge } from './ipc';
import { installNotificationClickThrough } from './notifications';
import { openDesktopSettings } from './settings/store';
import { installAdaptiveTheme } from './theme';
import './index.css';

setKeyboardShortcutPlatform(systemBridge.app.platform === 'darwin' ? 'mac' : 'non-mac');

initializeProductAnalytics({
  projectToken: import.meta.env.RENDERER_VITE_POSTHOG_PROJECT_TOKEN,
  host: import.meta.env.RENDERER_VITE_POSTHOG_HOST,
  surface: 'desktop',
  platform: systemBridge.app.platform,
});

let desktopRendererTraceSampleRate =
  DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate.desktopRenderer;

// Renderer events route through the main process, which owns the DSN/transport — passing dsn here has no effect.
// Combine with @sentry/react so React component stacks and error boundaries are captured.
sentryInit(
  {
    integrations: [
      browserTracingIntegration({
        instrumentPageLoad: false,
        instrumentNavigation: false,
        traceFetch: false,
        traceXHR: false,
        enableHTTPTimings: false,
        ignoreResourceSpans: ['resource.script', 'resource.css', 'resource.img', 'resource.other'],
        ignorePerformanceApiSpans: [/.*/],
      }),
    ],
    ignoreSpans: [{ op: /^resource\./ }],
    beforeSendTransaction: (event) =>
      sanitizeSentryTransaction(event, {
        fallbackTransactionName: 'desktop renderer operation',
        safeTransactionNames: DESKTOP_TRANSACTION_NAMES,
        safeSpanNames: DESKTOP_SPAN_NAMES,
      }),
    sendDefaultPii: false,
    tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(desktopRendererTraceSampleRate),
  },
  reactInit,
);
if (__LINKCODE_SENTRY_ENABLED__) void fetchTelemetryConfig().then(applyTelemetryConfig);
const rendererStartupSpan = startInactiveSpan({
  name: 'desktop renderer bootstrap',
  op: 'ui.load',
  forceTransaction: true,
});
setActiveSpanInBrowser(rendererStartupSpan);
const ProfiledDesktopApp = withProfiler(DesktopApp, {
  name: 'DesktopApp',
  includeRender: true,
  includeUpdates: false,
});
const uninstallNavigationTracing = installNavigationPerformanceObserver((surface) => {
  const client = getClient();
  if (!client) return;
  const span = startBrowserTracingNavigationSpan(client, {
    name: `desktop ${surface}`,
    op: 'navigation',
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => span?.end());
  });
});
if (import.meta.hot) import.meta.hot.dispose(uninstallNavigationTracing);

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

const uninstallAdaptiveTheme = installAdaptiveTheme();
if (import.meta.hot) import.meta.hot.dispose(uninstallAdaptiveTheme);

const uninstallAppearancePrefs = installAppearancePrefs();
if (import.meta.hot) import.meta.hot.dispose(uninstallAppearancePrefs);

// Menubar / Cmd+, opens Settings even while the daemon is unreachable.
const unsubscribeOpenSettings = systemBridge.app.onOpenSettings(() => {
  openDesktopSettings();
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribeOpenSettings);

const unsubscribeNotificationClicks = installNotificationClickThrough();
if (import.meta.hot) import.meta.hot.dispose(unsubscribeNotificationClicks);

createRoot(el).render(<ProfiledDesktopApp />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => rendererStartupSpan.end());
});

function applyTelemetryConfig(config: TelemetryConfig | null): void {
  if (config) desktopRendererTraceSampleRate = config.sentry.tracesSampleRate.desktopRenderer;
}
