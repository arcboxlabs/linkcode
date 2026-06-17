import { defineInvokeHandlers } from '@moeru/eventa';
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main';
import type { BrowserWindow, IpcMain } from 'electron';
import { PickFileOptionsSchema, type SystemContext } from './context';
import { systemIpcEvents } from './events';

export interface ElectronSystemIpcOptions {
  ipcMain: IpcMain;
  window: BrowserWindow;
  ctx: SystemContext;
}

export function bindElectronSystemIpc({
  ipcMain,
  window,
  ctx,
}: ElectronSystemIpcOptions): (reason?: unknown) => void {
  const { context, dispose: disposeContext } = createMainContext(ipcMain, window, {
    onlySameWindow: true,
  });

  const removeHandlers = defineInvokeHandlers(context, systemIpcEvents, {
    windowMinimize: () => {
      ctx.window.minimize();
    },
    windowToggleMaximize: () => {
      ctx.window.toggleMaximize();
    },
    windowClose: () => {
      ctx.window.close();
    },
    windowIsMaximized: () => ctx.window.isMaximized(),
    fsPickFile: (opts) => ctx.dialog.pickFile(PickFileOptionsSchema.optional().parse(opts)),
    appVersion: () => ctx.app.getVersion(),
    appPlatform: () => ctx.app.getPlatform(),
  });

  let disposed = false;
  const dispose = (reason?: unknown): void => {
    if (disposed) return;
    disposed = true;
    for (const removeHandler of Object.values(removeHandlers)) removeHandler();
    disposeContext(reason);
  };

  window.once('closed', () => dispose(new Error('electron system ipc window closed')));

  return dispose;
}
