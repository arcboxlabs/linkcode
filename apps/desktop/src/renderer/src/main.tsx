import { WorkbenchApp } from '@linkcode/workbench';
import { init as sentryInit } from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';
import { createRoot } from 'react-dom/client';
import { DAEMON_URL, transport } from './lib/transport';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';
import { installAdaptiveTheme } from './theme';
import 'allotment/dist/style.css';
import './index.css';

// Renderer events route through the main process, which owns the DSN/transport — passing dsn here has no effect.
// Combine with @sentry/react so React component stacks and error boundaries are captured.
sentryInit({}, reactInit);

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

const uninstallAdaptiveTheme = installAdaptiveTheme();
if (import.meta.hot) import.meta.hot.dispose(uninstallAdaptiveTheme);

createRoot(el).render(
  <WorkbenchApp
    transport={transport}
    daemonUrl={DAEMON_URL}
    shellComponent={DesktopWorkbenchShell}
  />,
);
