import { defineInvokeEventa } from '@moeru/eventa';
import type { DesktopSettings, DesktopSettingsPatch, PickFileOptions } from './context';

export const WINDOW_MAXIMIZED_CHANGED_CHANNEL = 'linkcode.system.window.maximizedChanged';
/** Synchronous boot snapshot of desktop settings (read via `ipcRenderer.sendSync`). */
export const SETTINGS_SNAPSHOT_CHANNEL = 'linkcode.system.settings.snapshot';
/** Synchronous effective daemon endpoint (read via `ipcRenderer.sendSync`, needed before first paint). */
export const DAEMON_URL_SNAPSHOT_CHANNEL = 'linkcode.system.daemon.urlSnapshot';
/** Main → renderer push: the menubar/Cmd+, asked to open Settings. */
export const SETTINGS_OPEN_CHANNEL = 'linkcode.system.settings.open';
/** Main → renderer push: auto-update lifecycle status. */
export const UPDATER_STATUS_CHANNEL = 'linkcode.system.app.updaterStatus';

export const systemIpcEvents = {
  windowMinimize: defineInvokeEventa<void>('linkcode.system.window.minimize'),
  windowToggleMaximize: defineInvokeEventa<void>('linkcode.system.window.toggleMaximize'),
  windowClose: defineInvokeEventa<void>('linkcode.system.window.close'),
  windowIsMaximized: defineInvokeEventa<boolean>('linkcode.system.window.isMaximized'),
  fsPickFile: defineInvokeEventa<string | null, PickFileOptions | undefined>(
    'linkcode.system.fs.pickFile',
  ),
  appVersion: defineInvokeEventa<string>('linkcode.system.app.version'),
  appPlatform: defineInvokeEventa<NodeJS.Platform>('linkcode.system.app.platform'),
  appCheckForUpdates: defineInvokeEventa<void>('linkcode.system.app.checkForUpdates'),
  settingsGet: defineInvokeEventa<DesktopSettings>('linkcode.system.settings.get'),
  settingsSet: defineInvokeEventa<DesktopSettings, DesktopSettingsPatch>(
    'linkcode.system.settings.set',
  ),
};
