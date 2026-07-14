import { join } from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { app, BrowserWindow, Menu } from 'electron';
import log from 'electron-log';
import { applyThemePreference } from './appearance';
import { setupCloudAuth } from './cloud-auth/client';
import { registerCloudImBridge } from './cloud-auth/im';
import { registerCloudTunnelBridge } from './cloud-auth/tunnel';
import { APP_ID, APP_NAME } from './constants';
import { startDaemonSupervisor } from './daemon-supervisor';
import { buildAppMenu } from './menu';
import { getSettings } from './settings';
import { initAutoUpdates } from './updater';
import { createDesktopWindow } from './window';

Sentry.init({
  dsn: import.meta.env.MAIN_VITE_SENTRY_DSN,
});

app.setName(APP_NAME);
// setName alone is not enough: Electron pins userData from package.json's productName before
// any app code runs, and electron-builder bakes the release productName ("LinkCode") into the
// asar even for dev-shell packages. Without this, a packaged dev shell shares the release app's
// settings and single-instance lock — the second one to start exits silently.
app.setPath('userData', join(app.getPath('appData'), APP_NAME));
// Self-evidence for identity drift: any module that resolves a path before the lines above
// lands in the wrong profile, and this line makes that visible on day one.
log.info(`userData: ${app.getPath('userData')}`);

// Windows keys the taskbar icon, pinning, and notification identity off the AppUserModelID; without
// this the taskbar shows a blank/default icon. No-op on macOS/Linux.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// settings.ts caches settings in memory and rewrites the whole file on save, so two instances
// would last-write-wins clobber each other. Only one instance may run; a second launch just
// focuses the existing window instead.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().at(0);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Wire the LinkCode Cloud auth protocol + IPC bridges. Must run BEFORE app is ready:
  // the better-auth electron plugin registers a privileged scheme via
  // protocol.registerSchemesAsPrivileged, which throws once the app is ready.
  setupCloudAuth();
  // Cloud data bridges (online hosts, IM Channel). Not scheme-related, but registered here
  // alongside the rest of the cloud wiring; ipcMain.handle is safe before the app is ready.
  registerCloudTunnelBridge();
  registerCloudImBridge();

  app
    .whenReady()
    .then(() => {
      // Dev only: brand the macOS Dock (the stock Electron binary has no icon). Use a static,
      // macOS-grid-margined glass render of the .icon — a full-bleed raster looks oversized in the
      // Dock. Loaded by path so this dev-only image isn't bundled into prod; packaged builds render
      // live Liquid Glass from the .icon.
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
      initAutoUpdates();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
      });
    })
    .catch((err) => {
      console.error('[link-code/desktop] failed to start:', err);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
} else {
  app.quit();
}
