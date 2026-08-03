import { BrowserWindow, ipcMain } from 'electron';
import {
  CONFIG_HOT_UPDATE_CHANNEL,
  CONFIG_REFRESH_CHANNEL,
  CONFIG_SNAPSHOT_CHANNEL,
  CONFIG_SNAPSHOT_INFO_CHANNEL,
} from '../shared/config';
import { getDesktopConfig } from './config';

export function registerDesktopConfigIpc(): () => void {
  const snapshot = (event: Electron.IpcMainEvent): void => {
    assertTrustedRenderer(event);
    event.returnValue = getDesktopConfig().effectiveSnapshot();
  };
  const snapshotInfo = (event: Electron.IpcMainEvent): void => {
    assertTrustedRenderer(event);
    event.returnValue = getDesktopConfig().snapshotInfo();
  };
  ipcMain.on(CONFIG_SNAPSHOT_CHANNEL, snapshot);
  ipcMain.on(CONFIG_SNAPSHOT_INFO_CHANNEL, snapshotInfo);
  ipcMain.handle(CONFIG_REFRESH_CHANNEL, (event) => {
    assertTrustedRenderer(event);
    return getDesktopConfig().refresh();
  });
  const unsubscribe = getDesktopConfig().onHotUpdate((keys) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CONFIG_HOT_UPDATE_CHANNEL, keys);
    }
  });
  return () => {
    unsubscribe();
    ipcMain.removeListener(CONFIG_SNAPSHOT_CHANNEL, snapshot);
    ipcMain.removeListener(CONFIG_SNAPSHOT_INFO_CHANNEL, snapshotInfo);
    ipcMain.removeHandler(CONFIG_REFRESH_CHANNEL);
  };
}

function assertTrustedRenderer(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (event.senderFrame !== window?.webContents.mainFrame) {
    throw new Error('Config IPC is restricted to a desktop window main frame');
  }
}
