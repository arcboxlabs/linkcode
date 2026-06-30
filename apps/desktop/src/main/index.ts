import { join } from 'node:path';
import type { SystemContext } from '@linkcode/ipc';
import { bindElectronSystemIpc } from '@linkcode/ipc/electron-main';
import type { BrowserWindowConstructorOptions } from 'electron';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { initAutoUpdates } from './updater';

const APP_NAME = 'LinkCode';
const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';
// Keep in sync with coss-ui's light/dark `--sidebar` tokens used by `bg-sidebar`.
const SIDEBAR_LIGHT_WINDOW_BACKGROUND = '#fafafa';
const SIDEBAR_DARK_WINDOW_BACKGROUND = '#09090b';

app.setName(APP_NAME);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    center: true,
    show: false,
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

function desktopBackgroundColor(): string {
  if (process.platform === 'darwin') {
    return TRANSPARENT_WINDOW_BACKGROUND;
  }

  return nativeTheme.shouldUseDarkColors
    ? SIDEBAR_DARK_WINDOW_BACKGROUND
    : SIDEBAR_LIGHT_WINDOW_BACKGROUND;
}

function desktopBackdropOptions(): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial' | 'transparent' | 'vibrancy' | 'visualEffectState'
> {
  if (process.platform === 'darwin') {
    return {
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      transparent: true,
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    };
  }

  if (process.platform === 'win32') {
    return {
      backgroundColor: desktopBackgroundColor(),
      backgroundMaterial: 'acrylic',
    };
  }

  return {
    backgroundColor: desktopBackgroundColor(),
  };
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

function createDesktopWindow(): BrowserWindow {
  const win = createWindow();
  const ctx = systemContextFor(win);

  // The data plane never goes through here; Eventa is used only for desktop system / UI calls.
  bindElectronSystemIpc({ ipcMain, window: win, ctx });
  return win;
}

/** Binds the system IPC capability contract to the real Electron implementation (system / UI only, PLAN §2.3). */
function systemContextFor(win: BrowserWindow): SystemContext {
  return {
    window: {
      minimize: () => win.minimize(),
      toggleMaximize() {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      },
      close: () => win.close(),
      isMaximized: () => win.isMaximized(),
    },
    dialog: {
      async pickFile(opts) {
        const result = await dialog.showOpenDialog(win, {
          title: opts?.title,
          properties: [opts?.directory ? 'openDirectory' : 'openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    },
    app: {
      getVersion: () => app.getVersion(),
      getPlatform: () => process.platform,
    },
  };
}

app
  .whenReady()
  .then(() => {
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
