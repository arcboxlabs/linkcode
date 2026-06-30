import { join } from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { app, BrowserWindow } from 'electron';
import { APP_NAME } from './constants';
import { initAutoUpdates } from './updater';
import { createDesktopWindow } from './window';

Sentry.init({
  dsn: import.meta.env.MAIN_VITE_SENTRY_DSN,
});

app.setName(APP_NAME);

app
  .whenReady()
  .then(() => {
    // Dev only: brand the macOS Dock (the stock Electron binary has no icon). Use a static,
    // macOS-grid-margined glass render of the .icon — a full-bleed raster looks oversized in the
    // Dock. Loaded by path so this dev-only image isn't bundled into prod; packaged builds render
    // live Liquid Glass from the .icon.
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(join(__dirname, '../../build-resources/icon-dock.png'));
    }
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
