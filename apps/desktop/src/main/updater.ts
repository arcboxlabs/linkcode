import type { UpdaterStatus } from '@linkcode/ipc';
import { dialog } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { CHANNEL } from './constants';

/** A dev shell must never pull the production feed and replace itself with the release build. */
const updatesDisabled = (): boolean => CHANNEL === 'development';

/**
 * Auto-update wiring (system plane only — never carries business data).
 *
 * electron-updater reads its feed from the `publish` block baked into the packaged
 * app by electron-builder, so no URL is configured here. Updates only run in a
 * packaged app; this is a no-op in `electron-vite dev`.
 */

type UpdaterStatusListener = (status: UpdaterStatus) => void;
const statusListeners = new Set<UpdaterStatusListener>();

/** Subscribe to auto-update lifecycle status; the IPC layer forwards these to the renderer. */
export function onUpdaterStatus(listener: UpdaterStatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function emitStatus(status: UpdaterStatus): void {
  for (const listener of statusListeners) listener(status);
}

export function initAutoUpdates(): void {
  if (updatesDisabled()) return;

  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  autoUpdater.on('checking-for-update', () => emitStatus('checking'));
  autoUpdater.on('update-available', () => emitStatus('available'));
  autoUpdater.on('update-not-available', () => emitStatus('not-available'));
  autoUpdater.on('download-progress', () => emitStatus('downloading'));
  autoUpdater.on('update-downloaded', ({ version }) => {
    emitStatus('downloaded');
    void promptInstall(version);
  });
  autoUpdater.on('error', (err) => {
    emitStatus('error');
    log.error('[link-code/desktop] auto-update failed:', err);
  });

  // autoDownload defaults to true, so a found update downloads and fires `update-downloaded`.
  void autoUpdater.checkForUpdates();
}

/** Manual update check triggered from Settings → About. */
export function checkForUpdates(): void {
  if (updatesDisabled()) {
    // Dev shells have no feed of their own; report a stable result.
    emitStatus('not-available');
    return;
  }
  emitStatus('checking');
  void autoUpdater.checkForUpdates().catch(() => emitStatus('error'));
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
