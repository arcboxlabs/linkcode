import { join } from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { app, BrowserWindow, Menu } from 'electron';
import { applyThemePreference } from './appearance';
import { setupCloudAuth } from './cloud-auth/client';
import { APP_NAME } from './constants';
import { buildAppMenu } from './menu';
import { getSettings } from './settings';
import { initAutoUpdates } from './updater';
import { createDesktopWindow } from './window';

Sentry.init({
  dsn: import.meta.env.MAIN_VITE_SENTRY_DSN,
});

app.setName(APP_NAME);

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
