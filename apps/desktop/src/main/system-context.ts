import type { SystemContext } from '@linkcode/ipc';
import { NOTIFICATION_CLICKED_CHANNEL } from '@linkcode/ipc';
import type { BrowserWindow } from 'electron';
import { app, dialog, Notification } from 'electron';
import { applyThemePreference } from './appearance';
import { resolveDaemonUrl } from './daemon-discovery';
import { isDaemonManaged, syncDaemonSupervisor } from './daemon-supervisor';
import { ensureDefaultPickerDirectory } from './default-picker-directory';
import { getSettings, setSettings } from './settings';
import { checkForUpdates } from './updater';

/** Binds the system IPC capability contract to the real Electron implementation (system / UI only, docs/ARCHITECTURE.md#core-principles). */
export function systemContextFor(win: BrowserWindow): SystemContext {
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
          defaultPath: opts?.directory ? await ensureDefaultPickerDirectory() : undefined,
          properties: [opts?.directory ? 'openDirectory' : 'openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    },
    app: {
      getVersion: () => app.getVersion(),
      getPlatform: () => process.platform,
      checkForUpdates: () => checkForUpdates(),
    },
    settings: {
      get: () => getSettings(),
      set(patch) {
        const next = setSettings(patch);
        applyThemePreference(next.theme);
        // Clearing the daemonUrl override makes this app the daemon's manager mid-session.
        syncDaemonSupervisor();
        return next;
      },
    },
    daemon: {
      resolveUrl: () => resolveDaemonUrl(),
      isManaged: () => isDaemonManaged(),
    },
    notifications: {
      notify({ title, body, clickToken }) {
        // Unsupported (e.g. Windows without a shortcut/AppUserModelID) degrades to a silent no-op.
        if (!Notification.isSupported()) return;
        const notification = new Notification({ title, body });
        notification.on('click', () => {
          if (win.isDestroyed()) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          win.webContents.send(NOTIFICATION_CLICKED_CHANNEL, clickToken);
        });
        notification.show();
      },
    },
  };
}
