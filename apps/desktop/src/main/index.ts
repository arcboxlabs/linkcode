// The identity side effect (app name, userData, AppUserModelID) must run before every other
// import's module body — see identity.ts.
import './identity';

import { join } from 'node:path';
import { sanitizeSentryTransaction } from '@linkcode/common/sentry';
import type { TelemetryConfig } from '@linkcode/common/telemetry-config';
import { DEFAULT_TELEMETRY_CONFIG, fetchTelemetryConfig } from '@linkcode/common/telemetry-config';
import * as Sentry from '@sentry/electron/main';
import { app, BrowserWindow, Menu } from 'electron';
import { DESKTOP_SPAN_NAMES, DESKTOP_TRANSACTION_NAMES } from '../sentry-privacy';
import { applyThemePreference } from './appearance';
import { setupCloudAuth } from './cloud-auth/client';
import { registerCloudImBridge } from './cloud-auth/im';
import { registerCloudTunnelBridge } from './cloud-auth/tunnel';
import { startDaemonSupervisor } from './daemon-supervisor';
import { buildAppMenu } from './menu';
import { getSettings } from './settings';
import { initAutoUpdates } from './updater';
import { createDesktopWindow } from './window';

let desktopMainTraceSampleRate = DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate.desktopMain;

Sentry.init({
  dsn: import.meta.env.MAIN_VITE_SENTRY_DSN,
  beforeSendTransaction: (event) =>
    sanitizeSentryTransaction(event, {
      fallbackTransactionName: 'desktop main operation',
      safeTransactionNames: DESKTOP_TRANSACTION_NAMES,
      safeSpanNames: DESKTOP_SPAN_NAMES,
    }),
  sendDefaultPii: false,
  tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(desktopMainTraceSampleRate),
});
void Sentry.suppressTracing(fetchTelemetryConfig).then(applyTelemetryConfig);

// settings.ts caches in memory and rewrites the whole file on save, so two instances would
// last-write-wins clobber each other; a second launch just focuses the existing window.
if (app.requestSingleInstanceLock()) {
  const startupSpan = Sentry.startInactiveSpan({
    name: 'desktop main startup',
    op: 'app.start',
    forceTransaction: true,
  });
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().at(0);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Wire the LinkCode Cloud auth protocol + IPC bridges. Must run BEFORE app is ready: the plugin
  // registers a privileged scheme via protocol.registerSchemesAsPrivileged, which throws once ready.
  setupCloudAuth();
  // Cloud data bridges (online hosts, IM Channel). Not scheme-related, but registered here
  // alongside the rest of the cloud wiring; ipcMain.handle is safe before the app is ready.
  registerCloudTunnelBridge();
  registerCloudImBridge();

  app
    .whenReady()
    .then(() => {
      // Dev only: brand the macOS Dock (stock Electron has no icon) with a static grid-margined
      // glass render — a full-bleed raster looks oversized. Loaded by path so it isn't bundled
      // into prod; packaged builds render live Liquid Glass from the .icon.
      if (process.platform === 'darwin' && !app.isPackaged) {
        app.dock?.setIcon(join(__dirname, '../../../../assets/icon-dock.png'));
      }
      // Before the window: the renderer's first connection attempt then races a daemon that is
      // already starting instead of one that doesn't exist yet.
      startDaemonSupervisor();
      // Apply the stored color scheme before the window exists so its chrome paints correctly first time.
      applyThemePreference(getSettings().theme);
      Menu.setApplicationMenu(buildAppMenu());
      createDesktopWindow();
      startupSpan.end();
      initAutoUpdates();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
      });
    })
    .catch((err) => {
      startupSpan.end();
      console.error('[link-code/desktop] failed to start:', err);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
} else {
  app.quit();
}

function applyTelemetryConfig(config: TelemetryConfig | null): void {
  if (config) desktopMainTraceSampleRate = config.sentry.tracesSampleRate.desktopMain;
}
