import { join } from 'node:path';
import { UPDATER_STATUS_CHANNEL } from '@linkcode/ipc';
import { bindElectronSystemIpc } from '@linkcode/ipc/electron-main';
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
// electron-vite resolves `?asset` to a runtime file path. Used as the Win/Linux window icon in dev
// (packaged builds get the real icon from the bundle). macOS uses a separate Dock image set at bootstrap.
import icon from '../../build-resources/icon-dock.png?asset';
import { desktopBackdropOptions, desktopBackgroundColor } from './appearance';
import { APP_NAME } from './constants';
import { systemContextFor } from './system-context';
import { onUpdaterStatus } from './updater';

export function createDesktopWindow(): BrowserWindow {
  const win = createWindow();
  const ctx = systemContextFor(win);

  // The data plane never goes through here; Eventa is used only for desktop system / UI calls.
  bindElectronSystemIpc({ ipcMain, window: win, ctx });

  // Forward auto-update status (a main-side singleton) to this window's renderer.
  const unsubscribeUpdater = onUpdaterStatus((status) => {
    if (!win.isDestroyed()) win.webContents.send(UPDATER_STATUS_CHANNEL, status);
  });
  win.once('closed', unsubscribeUpdater);

  return win;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    center: true,
    show: false,
    icon,
    title: APP_NAME,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : null),
    ...desktopBackdropOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const updateBackgroundColor = (): void => {
    win.setBackgroundColor(desktopBackgroundColor());
  };
  win.on('ready-to-show', () => win.show());
  nativeTheme.on('updated', updateBackgroundColor);
  win.on('closed', () => nativeTheme.off('updated', updateBackgroundColor));
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[link-code/desktop] renderer load failed:', {
      errorCode,
      errorDescription,
      url: validatedURL,
    });
  });

  void loadRenderer(win);
  return win;
}

async function loadRenderer(win: BrowserWindow): Promise<void> {
  // In electron-vite dev mode the renderer URL is injected; in production we load the bundled html.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  try {
    if (devUrl) {
      await win.loadURL(devUrl);
    } else {
      await win.loadFile(join(__dirname, '../renderer/index.html'));
    }
  } catch (err) {
    console.error('[link-code/desktop] unable to load renderer:', err);
  }
}
