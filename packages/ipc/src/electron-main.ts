import { defineInvokeHandlers } from '@moeru/eventa';
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main';
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron';
import type { SystemContext } from './context';
import {
  DesktopSettingsPatchSchema,
  PickFileOptionsSchema,
  SystemNotificationSchema,
} from './context';
import {
  DAEMON_URL_SNAPSHOT_CHANNEL,
  SETTINGS_SNAPSHOT_CHANNEL,
  systemIpcEvents,
  WINDOW_MAXIMIZED_CHANGED_CHANNEL,
} from './events';

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
    windowMinimize() {
      ctx.window.minimize();
    },
    windowToggleMaximize() {
      ctx.window.toggleMaximize();
    },
    windowClose() {
      ctx.window.close();
    },
    windowIsMaximized: () => ctx.window.isMaximized(),
    fsPickFile: (opts) => ctx.dialog.pickFile(PickFileOptionsSchema.optional().parse(opts)),
    appVersion: () => ctx.app.getVersion(),
    appPlatform: () => ctx.app.getPlatform(),
    appCheckForUpdates: () => ctx.app.checkForUpdates(),
    daemonIsManaged: () => ctx.daemon.isManaged(),
    settingsGet: () => ctx.settings.get(),
    settingsSet: (patch) => ctx.settings.set(DesktopSettingsPatchSchema.parse(patch)),
    notificationsNotify: (notification) =>
      ctx.notifications.notify(SystemNotificationSchema.parse(notification)),
  });

  // Synchronous boot snapshot: the renderer needs locale + daemonUrl before first paint, which the
  // async invoke path can't provide. Served over a raw `sendSync` channel returning the current store.
  const handleSnapshot = (event: IpcMainEvent): void => {
    event.returnValue = ctx.settings.get();
  };
  ipcMain.on(SETTINGS_SNAPSHOT_CHANNEL, handleSnapshot);

  // Same sendSync rationale: the renderer dials the daemon on first paint, and re-resolves
  // synchronously when an explicit override is cleared.
  const handleDaemonUrlSnapshot = (event: IpcMainEvent): void => {
    event.returnValue = ctx.daemon.resolveUrl();
  };
  ipcMain.on(DAEMON_URL_SNAPSHOT_CHANNEL, handleDaemonUrlSnapshot);

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
    ipcMain.removeListener(SETTINGS_SNAPSHOT_CHANNEL, handleSnapshot);
    ipcMain.removeListener(DAEMON_URL_SNAPSHOT_CHANNEL, handleDaemonUrlSnapshot);
    window.off('maximize', emitMaximizedState);
    window.off('unmaximize', emitMaximizedState);
    window.off('enter-full-screen', emitMaximizedState);
    window.off('leave-full-screen', emitMaximizedState);
    disposeContext(reason);
  };

  window.once('closed', () => dispose(new Error('electron system ipc window closed')));

  return dispose;
}
