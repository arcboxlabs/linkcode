import { SocketIoTransport } from '@linkcode/transport';
import type { WorkbenchSystemBridge } from '@linkcode/ui';
import { Workbench, WorkbenchProviders } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import type { ReactNode } from 'react';
import { AppI18nProvider } from '@/i18n/app-i18n-provider';
import { systemBridge } from '@/ipc';

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

/** Window controls go through system IPC — the system plane, never business data (PLAN §4.5). */
const bridge: WorkbenchSystemBridge = {
  window: {
    minimize: () => systemBridge.window.minimize(),
    toggleMaximize: () => systemBridge.window.toggleMaximize(),
    close: () => systemBridge.window.close(),
    isMaximized: () => systemBridge.window.isMaximized(),
    onMaximizedChange: (cb) => systemBridge.window.onMaximizedChange?.(cb) ?? noop,
  },
  fs: {
    pickFile: (opts) => systemBridge.fs.pickFile(opts),
  },
  app: {
    version: () => systemBridge.app.version(),
    platform: () => systemBridge.app.platform(),
  },
};

export function App(): ReactNode {
  return (
    <AppI18nProvider>
      <WorkbenchProviders transport={transport} daemonUrl={DAEMON_URL}>
        <Workbench systemBridge={bridge} />
      </WorkbenchProviders>
    </AppI18nProvider>
  );
}
