import type { SystemContext } from '@linkcode/ipc';
import type { BrowserWindow } from 'electron';
import { app, dialog } from 'electron';
import { ensureDefaultWorkspace } from './workspace';

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
          defaultPath: opts?.directory ? await ensureDefaultWorkspace() : undefined,
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
