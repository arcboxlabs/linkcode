import { release } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DAEMON_RUNTIME_CHANGED_CHANNEL, UPDATER_STATUS_CHANNEL } from '@linkcode/ipc';
import { bindElectronSystemIpc } from '@linkcode/ipc/electron-main';
import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { extractErrorMessage } from 'foxts/extract-error-message';
// electron-vite resolves `?asset` to a runtime file path. Used as the Win/Linux window icon in dev
// (packaged builds get the real icon from the bundle). macOS uses a separate Dock image set at bootstrap.
// eslint-disable-next-line import-x/no-relative-packages -- shared repo-root brand asset; this private app has no package export for it, so a relative import is the resolvable form
import icon from '../../../../assets/icon-dock.png?asset';
import { desktopBackdropOptions, desktopBackgroundColor } from './appearance';
import { APP_NAME } from './constants';
import { watchDaemonRuntime } from './daemon-discovery';
import { systemContextFor } from './system-context';
import { onUpdaterStatus } from './updater';
import {
  deriveDefaultWindowSize,
  MIN_WINDOW_SIZE,
  persistWindowStateOnClose,
  readWindowState,
} from './window-state';

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

  // Push daemon runtime-file changes so the renderer rediscovers the endpoint immediately —
  // a daemon that restarts on a hunted port would otherwise be unreachable until app restart.
  const unwatchRuntime = watchDaemonRuntime(() => {
    if (!win.isDestroyed()) win.webContents.send(DAEMON_RUNTIME_CHANGED_CHANNEL);
  });
  win.once('closed', unwatchRuntime);

  return win;
}

function createWindow(): BrowserWindow {
  const restored = readWindowState();
  const win = new BrowserWindow({
    ...(restored ? restored.bounds : { ...deriveDefaultWindowSize(), center: true }),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    icon,
    title: APP_NAME,
    titleBarStyle: 'hidden',
    // macOS 26 Tahoe (Darwin ≥ 25) shrank the traffic-light frame height 16pt → 14pt (same fix as
    // microsoft/vscode#279769); y = floor((40 − frameHeight) / 2) centers the buttons on the 40px
    // chrome bar (renderer DESKTOP_CHROME_METRICS.height).
    ...(process.platform === 'darwin' && {
      trafficLightPosition: { x: 16, y: Number.parseFloat(release()) >= 25 ? 13 : 12 },
    }),
    ...desktopBackdropOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Chromium's built-in PDF viewer (the files-section PDF tabs) is a plugin.
      plugins: true,
      // The right panel's Browser section renders an Electron <webview>.
      webviewTag: true,
    },
  });

  // window.open / target=_blank means "the system browser" everywhere in the app
  // (chat links, preview open-external); nothing may spawn a child Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  persistWindowStateOnClose(win);

  const updateBackgroundColor = (): void => {
    win.setBackgroundColor(desktopBackgroundColor());
  };
  win.on('ready-to-show', () => {
    // Display-state restore waits for first show: maximize() on a hidden window shows it early
    // on Windows, and setFullScreen must not race the initial paint.
    if (restored?.maximized) win.maximize();
    if (restored?.fullScreen) win.setFullScreen(true);
    win.show();
  });
  nativeTheme.on('updated', updateBackgroundColor);
  win.on('closed', () => nativeTheme.off('updated', updateBackgroundColor));
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeDesktopError('[link-code/desktop] renderer load failed:', {
      errorCode,
      errorDescription,
      url: validatedURL,
    });
  });

  // Agent-authored links can target untrusted URLs; an unhandled popup would open a new window
  // that inherits the preload — deny every popup and hand http(s) targets to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Same untrusted-link surface via in-page navigation (no target="_blank"): only allow the
  // renderer to navigate within itself (the dev server origin or the packaged entry file).
  win.webContents.on('will-navigate', (event, url) => {
    if (isSelfNavigation(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
  });

  void loadRenderer(win);
  return win;
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Mirrors {@link loadRenderer}'s allowed targets: the dev server origin, or the packaged entry file. */
function isSelfNavigation(url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return target.origin === new URL(devUrl).origin;
  const entry = pathToFileURL(join(__dirname, '../renderer/index.html'));
  return target.protocol === 'file:' && target.pathname === entry.pathname;
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
    writeDesktopError('[link-code/desktop] unable to load renderer:', extractErrorMessage(err));
  }
}

function writeDesktopError(message: string, detail: unknown): void {
  process.stderr.write(`${message} ${JSON.stringify(detail)}\n`);
}
