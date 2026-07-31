import type { UpdaterState, UpdaterStatus } from '@linkcode/ipc';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { noop } from 'foxts/noop';
import { CHANNEL } from './constants';

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** A dev shell must never pull the production feed and replace itself with the release build. */
const updatesDisabled = (): boolean => CHANNEL === 'development';

/**
 * Auto-update wiring (system plane only). electron-updater reads its feed from the `publish` block
 * electron-builder bakes into the packaged app, so no URL is configured here; a no-op outside a
 * packaged app.
 */

type UpdaterStateListener = (state: UpdaterState) => void;
const stateListeners = new Set<UpdaterStateListener>();
let updaterState: UpdaterState = { status: 'idle', version: null, progress: null };

/** Subscribe to auto-update lifecycle state; the IPC layer forwards these to the renderer. */
export function onUpdaterState(listener: UpdaterStateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getUpdaterState(): UpdaterState {
  return updaterState;
}

function emitState(
  status: UpdaterStatus,
  version = updaterState.version,
  progress: number | null = null,
): void {
  updaterState = { status, version, progress };
  for (const listener of stateListeners) listener(updaterState);
}

export function initAutoUpdates(): void {
  if (updatesDisabled()) return;

  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  autoUpdater.on('checking-for-update', () => emitState('checking', null));
  autoUpdater.on('update-available', ({ version }) => emitState('available', version));
  autoUpdater.on('update-not-available', () => emitState('not-available', null));
  autoUpdater.on('download-progress', ({ percent }) => {
    emitState('downloading', updaterState.version, percent);
  });
  autoUpdater.on('update-downloaded', ({ version }) => {
    emitState('downloaded', version);
  });
  autoUpdater.on('error', (err) => {
    emitState('error');
    log.error('[link-code/desktop] auto-update failed:', err);
  });

  // autoDownload defaults to true, so a found update downloads and fires `update-downloaded`.
  checkForUpdates();
  const timer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  timer.unref();
}

/** Manual update check triggered from Settings → About. */
export function checkForUpdates(): void {
  if (updatesDisabled()) {
    // Dev shells have no feed of their own; report a stable result.
    emitState('not-available', null);
    return;
  }
  if (updaterState.status === 'downloaded') return;
  emitState('checking', null);
  // electron-updater emits `error` before rejecting; that listener owns status and logging.
  void autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (result === null) emitState('not-available', null);
    })
    .catch(noop);
}

export function installUpdate(): void {
  if (updaterState.status !== 'downloaded') throw new Error('No downloaded update to install');
  autoUpdater.quitAndInstall();
}
