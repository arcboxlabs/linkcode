import { setKeyboardShortcutPlatform } from '@linkcode/ui';
import { init as sentryInit } from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';
import { createRoot } from 'react-dom/client';
import { DesktopApp } from './app';
import { systemBridge } from './ipc';
import { installNotificationClickThrough } from './notifications';
import { openDesktopSettings } from './settings/store';
import { installAdaptiveTheme } from './theme';
import './index.css';

setKeyboardShortcutPlatform(systemBridge.app.platform === 'darwin' ? 'mac' : 'non-mac');

// Renderer events route through the main process, which owns the DSN/transport — passing dsn here has no effect.
// Combine with @sentry/react so React component stacks and error boundaries are captured.
sentryInit({}, reactInit);

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

const uninstallAdaptiveTheme = installAdaptiveTheme();
if (import.meta.hot) import.meta.hot.dispose(uninstallAdaptiveTheme);

// Menubar / Cmd+, opens Settings even while the daemon is unreachable.
const unsubscribeOpenSettings = systemBridge.app.onOpenSettings(() => {
  openDesktopSettings();
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribeOpenSettings);

const unsubscribeNotificationClicks = installNotificationClickThrough();
if (import.meta.hot) import.meta.hot.dispose(unsubscribeNotificationClicks);

createRoot(el).render(<DesktopApp />);
