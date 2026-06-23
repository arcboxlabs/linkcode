import { defineInvokes } from '@moeru/eventa';
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer';
import type { IpcRenderer } from 'electron';
import type { SystemBridge } from './bridge';
import { systemIpcEvents, WINDOW_MAXIMIZED_CHANGED_CHANNEL } from './events';

type EventaRendererIpc = Parameters<typeof createRendererContext>[0];
type IpcRendererListener = Parameters<IpcRenderer['on']>[1];

export function createElectronSystemBridge(ipcRenderer: IpcRenderer): SystemBridge {
  const { context } = createRendererContext(toEventaRendererIpc(ipcRenderer));
  const invoke = defineInvokes(context, systemIpcEvents);

  return {
    window: {
      minimize: () => invoke.windowMinimize(),
      toggleMaximize: () => invoke.windowToggleMaximize(),
      close: () => invoke.windowClose(),
      isMaximized: () => invoke.windowIsMaximized(),
      onMaximizedChange(cb) {
        const handler: IpcRendererListener = (_event, value: unknown) => {
          if (typeof value === 'boolean') cb(value);
        };
        ipcRenderer.on(WINDOW_MAXIMIZED_CHANGED_CHANNEL, handler);
        return () => ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGED_CHANNEL, handler);
      },
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

function toEventaRendererIpc(ipcRenderer: unknown): EventaRendererIpc {
  return ipcRenderer as EventaRendererIpc;
}
