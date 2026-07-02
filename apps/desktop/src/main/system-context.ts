import type { SystemContext } from '@linkcode/ipc';
import type { BrowserWindow } from 'electron';
import { app, dialog } from 'electron';
import { applyThemePreference } from './appearance';
import { resolveDaemonUrl } from './daemon-discovery';
import { ensureDefaultPickerDirectory } from './default-picker-directory';
import { getSettings, setSettings } from './settings';
import { checkForUpdates } from './updater';

/** Binds the system IPC capability contract to the real Electron implementation (system / UI only, PLAN §2.3). */
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
        return next;
      },
    },
    daemon: {
      resolveUrl: () => resolveDaemonUrl(),
    },
  };
}
