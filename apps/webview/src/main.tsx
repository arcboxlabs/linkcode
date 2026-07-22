import { sanitizeSentryTransaction } from '@linkcode/common/sentry';
import type { TelemetryConfig } from '@linkcode/common/telemetry-config';
import { DEFAULT_TELEMETRY_CONFIG, fetchTelemetryConfig } from '@linkcode/common/telemetry-config';
import { setKeyboardShortcutPlatform } from '@linkcode/ui';
import { initializeProductAnalytics, installAppearancePrefs } from '@linkcode/workbench';
import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createWebviewRouter } from './router';
import { installTheme } from './settings/theme';
import './index.css';

setKeyboardShortcutPlatform(navigator.userAgent.includes('Mac') ? 'mac' : 'non-mac');

initializeProductAnalytics({
  projectToken: import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
  host: import.meta.env.VITE_POSTHOG_HOST,
  surface: 'webview',
  platform: 'web',
});

let webviewTraceSampleRate = DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate.webview;

// The DSN is a publishable identifier (not a secret); injected per-build via Vite's VITE_ env prefix.
// With no DSN the SDK no-ops, so local dev reports nothing unless VITE_SENTRY_DSN is set.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.reactRouterBrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
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
      fallbackTransactionName: 'webview navigation',
      safeTransactionNames: ['webview bootstrap', 'webview navigation'],
      safeSpanNames: ['<WebviewApp>'],
      safeMeasurementNames: ['cls', 'fcp', 'fid', 'fp', 'inp', 'lcp', 'ttfb'],
    }),
  sendDefaultPii: false,
  tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(webviewTraceSampleRate),
});
void fetchTelemetryConfig().then(applyTelemetryConfig);
const rendererStartupSpan = Sentry.startInactiveSpan({
  name: 'webview bootstrap',
  op: 'ui.load',
  forceTransaction: true,
});
// The wrapper reads integration hooks installed by Sentry.init, so it must not run at module scope.
const router = createWebviewRouter(Sentry.wrapCreateBrowserRouter(createBrowserRouter));
const ProfiledRouterProvider = Sentry.withProfiler(RouterProvider, {
  name: 'WebviewApp',
  includeRender: true,
  includeUpdates: false,
});

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// Apply the stored theme and appearance prefs before first paint; the app keeps them in sync after.
installTheme();
installAppearancePrefs();

createRoot(el).render(<ProfiledRouterProvider router={router} />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => rendererStartupSpan.end());
});

function applyTelemetryConfig(config: TelemetryConfig | null): void {
  if (config) webviewTraceSampleRate = config.sentry.tracesSampleRate.webview;
}
