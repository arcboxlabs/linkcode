import type { SystemBridge } from '@linkcode/ipc';
import { startSpan } from '@sentry/electron/renderer';

declare global {
  interface Window {
    linkcodeSystem: SystemBridge;
  }
}

const source = window.linkcodeSystem;

/** Traces only the fixed operation name; IPC arguments, results, paths, and errors stay out. */
export function traceRendererIpc<T>(operation: string, invoke: () => T): T {
  return startSpan({ name: `ipc ${operation}`, op: 'ipc.renderer' }, invoke);
}

export const systemBridge: SystemBridge = {
  window: {
    minimize: () => traceRendererIpc('window.minimize', () => source.window.minimize()),
    toggleMaximize: () =>
      traceRendererIpc('window.toggle-maximize', () => source.window.toggleMaximize()),
    close: () => traceRendererIpc('window.close', () => source.window.close()),
    isMaximized: () => traceRendererIpc('window.is-maximized', () => source.window.isMaximized()),
    onMaximizedChange: (callback) =>
      traceRendererIpc('window.on-maximized-change', () =>
        source.window.onMaximizedChange(callback),
      ),
  },
  fs: {
    pickFile: (opts) => traceRendererIpc('fs.pick-file', () => source.fs.pickFile(opts)),
  },
  app: {
    version: () => traceRendererIpc('app.version', () => source.app.version()),
    platform: source.app.platform,
    checkForUpdates: () =>
      traceRendererIpc('app.check-for-updates', () => source.app.checkForUpdates()),
    onUpdaterStatus: (callback) =>
      traceRendererIpc('app.on-updater-status', () => source.app.onUpdaterStatus(callback)),
    onOpenSettings: (callback) =>
      traceRendererIpc('app.on-open-settings', () => source.app.onOpenSettings(callback)),
  },
  settings: {
    get: () => traceRendererIpc('settings.get', () => source.settings.get()),
    set: (patch) => traceRendererIpc('settings.set', () => source.settings.set(patch)),
    snapshot: () => traceRendererIpc('settings.snapshot', () => source.settings.snapshot()),
  },
  daemon: {
    resolveUrl: () => traceRendererIpc('daemon.resolve-url', () => source.daemon.resolveUrl()),
    isManaged: () => traceRendererIpc('daemon.is-managed', () => source.daemon.isManaged()),
    retry: () => traceRendererIpc('daemon.retry', () => source.daemon.retry()),
    onRuntimeChanged: (callback) =>
      traceRendererIpc('daemon.on-runtime-changed', () => source.daemon.onRuntimeChanged(callback)),
  },
  notifications: {
    notify: (notification) =>
      traceRendererIpc('notifications.notify', () => source.notifications.notify(notification)),
    onClick: (callback) =>
      traceRendererIpc('notifications.on-click', () => source.notifications.onClick(callback)),
  },
};
