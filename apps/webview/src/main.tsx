import { setKeyboardShortcutPlatform } from '@linkcode/ui';
import { installAppearancePrefs } from '@linkcode/workbench';
import * as Sentry from '@sentry/react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';
import { installTheme } from './settings/theme';
import './index.css';

setKeyboardShortcutPlatform(navigator.userAgent.includes('Mac') ? 'mac' : 'non-mac');

// The DSN is a publishable identifier (not a secret); injected per-build via Vite's VITE_ env prefix.
// With no DSN the SDK no-ops, so local dev reports nothing unless VITE_SENTRY_DSN is set.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1,
});

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// Apply the stored theme and appearance prefs before first paint; the app keeps them in sync after.
installTheme();
installAppearancePrefs();

createRoot(el).render(<RouterProvider router={router} />);
