import { defineInvokeHandlers } from '@moeru/eventa';
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main';
import type { BrowserWindow, IpcMain } from 'electron';
import { PickFileOptionsSchema, type SystemContext } from './context';
import { systemIpcEvents, WINDOW_MAXIMIZED_CHANGED_CHANNEL } from './events';

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
  const emitMaximizedState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, ctx.window.isMaximized());
    }
  };
  window.on('maximize', emitMaximizedState);
  window.on('unmaximize', emitMaximizedState);
  window.on('enter-full-screen', emitMaximizedState);
  window.on('leave-full-screen', emitMaximizedState);

  let disposed = false;
  const dispose = (reason?: unknown): void => {
    if (disposed) return;
    disposed = true;
    for (const removeHandler of Object.values(removeHandlers)) removeHandler();
    window.off('maximize', emitMaximizedState);
    window.off('unmaximize', emitMaximizedState);
    window.off('enter-full-screen', emitMaximizedState);
    window.off('leave-full-screen', emitMaximizedState);
    disposeContext(reason);
  };

  window.once('closed', () => dispose(new Error('electron system ipc window closed')));

  return dispose;
}
