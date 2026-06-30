import { app, dialog } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

/**
 * Auto-update wiring (system plane only — never carries business data).
 *
 * electron-updater reads its feed from the `publish` block baked into the packaged
 * app by electron-builder, so no URL is configured here. Updates only run in a
 * packaged app; this is a no-op in `electron-vite dev`.
 */
export function initAutoUpdates(): void {
  if (!app.isPackaged) return;

  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  autoUpdater.on('update-downloaded', ({ version }) => {
    void promptInstall(version);
  });
  autoUpdater.on('error', (err) => {
    log.error('[link-code/desktop] auto-update failed:', err);
  });

  // autoDownload defaults to true, so a found update downloads and fires `update-downloaded`.
  void autoUpdater.checkForUpdates();
}

async function promptInstall(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: `LinkCode ${version} has been downloaded.`,
    detail: 'Restart to finish installing the update.',
  });
  if (response === 0) autoUpdater.quitAndInstall();
}
