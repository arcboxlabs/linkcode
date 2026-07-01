import * as Sentry from '@sentry/react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { installTheme } from './settings/theme';
import './index.css';

// The DSN is a publishable identifier (not a secret); injected per-build via Vite's VITE_ env prefix.
// With no DSN the SDK no-ops, so local dev reports nothing unless VITE_SENTRY_DSN is set.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1,
});

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// Apply the stored theme before first paint; the app keeps it in sync thereafter.
installTheme();

createRoot(el).render(<RouterProvider router={router} />);
