import { defineInvokes } from '@moeru/eventa';
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer';
import type { IpcRenderer } from 'electron';
import type { SystemBridge } from './bridge';
import { systemIpcEvents } from './events';

type EventaRendererIpc = Parameters<typeof createRendererContext>[0];

export function createElectronSystemBridge(ipcRenderer: IpcRenderer): SystemBridge {
  const { context } = createRendererContext(ipcRenderer as unknown as EventaRendererIpc);
  const invoke = defineInvokes(context, systemIpcEvents);

  return {
    window: {
      minimize: () => invoke.windowMinimize(),
      toggleMaximize: () => invoke.windowToggleMaximize(),
      close: () => invoke.windowClose(),
      isMaximized: () => invoke.windowIsMaximized(),
    },
    fs: {
      pickFile: (opts) => invoke.fsPickFile(opts),
    },
    app: {
      version: () => invoke.appVersion(),
      platform: () => invoke.appPlatform(),
    },
  };
}
