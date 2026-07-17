import { defineInvokeEventa } from '@moeru/eventa';
import type {
  DesktopSettings,
  DesktopSettingsPatch,
  PickFileOptions,
  SystemNotification,
} from './context';

export const WINDOW_MAXIMIZED_CHANGED_CHANNEL = 'linkcode.system.window.maximizedChanged';
/** Synchronous boot snapshot of desktop settings (read via `ipcRenderer.sendSync`). */
export const SETTINGS_SNAPSHOT_CHANNEL = 'linkcode.system.settings.snapshot';
/** Synchronous effective daemon endpoint (read via `ipcRenderer.sendSync`, needed before first paint). */
export const DAEMON_URL_SNAPSHOT_CHANNEL = 'linkcode.system.daemon.urlSnapshot';
/** Main → renderer push: the menubar/Cmd+, asked to open Settings. */
export const SETTINGS_OPEN_CHANNEL = 'linkcode.system.settings.open';
/** Main → renderer push: auto-update lifecycle status. */
export const UPDATER_STATUS_CHANNEL = 'linkcode.system.app.updaterStatus';
/** Main → renderer push: the daemon runtime file changed — rediscover the endpoint. */
export const DAEMON_RUNTIME_CHANGED_CHANNEL = 'linkcode.system.daemon.runtimeChanged';
/** Main → renderer push: an OS notification was clicked; payload is its `clickToken`. */
export const NOTIFICATION_CLICKED_CHANNEL = 'linkcode.system.notifications.clicked';
/** Main → renderer push: a Browser-pane guest page opened a popup; payload is its http(s) URL. */
export const BROWSER_OPEN_TAB_CHANNEL = 'linkcode.system.browser.openTab';
/** Main → renderer push: a Browser-pane download finished (any terminal state). */
export const BROWSER_DOWNLOAD_DONE_CHANNEL = 'linkcode.system.browser.downloadDone';

export const systemIpcEvents = {
  windowMinimize: defineInvokeEventa<void>('linkcode.system.window.minimize'),
  windowToggleMaximize: defineInvokeEventa<void>('linkcode.system.window.toggleMaximize'),
  windowClose: defineInvokeEventa<void>('linkcode.system.window.close'),
  windowIsMaximized: defineInvokeEventa<boolean>('linkcode.system.window.isMaximized'),
  fsPickFile: defineInvokeEventa<string[] | null, PickFileOptions | undefined>(
    'linkcode.system.fs.pickFile',
  ),
  appVersion: defineInvokeEventa<string>('linkcode.system.app.version'),
  appCheckForUpdates: defineInvokeEventa<void>('linkcode.system.app.checkForUpdates'),
  daemonIsManaged: defineInvokeEventa<boolean>('linkcode.system.daemon.isManaged'),
  daemonRetry: defineInvokeEventa<void>('linkcode.system.daemon.retry'),
  settingsGet: defineInvokeEventa<DesktopSettings>('linkcode.system.settings.get'),
  settingsSet: defineInvokeEventa<DesktopSettings, DesktopSettingsPatch>(
    'linkcode.system.settings.set',
  ),
  notificationsNotify: defineInvokeEventa<void, SystemNotification>(
    'linkcode.system.notifications.notify',
  ),
};
