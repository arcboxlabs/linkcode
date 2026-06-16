import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { IpcInvoke } from './context';
import type { SystemRouter } from './router';

/**
 * ipcLink: the terminating link for the renderer's tRPC client, sending operations to the main process
 * via the injected `invoke`. The carrier (Electron ipcRenderer.invoke, etc.) is injected by the caller,
 * so this package is decoupled from electron.
 */
export function ipcLink(invoke: IpcInvoke): TRPCLink<SystemRouter> {
  const link: TRPCLink<SystemRouter> = () => {
    return ({ op }) =>
      observable((observer) => {
        invoke({ path: op.path, type: op.type, input: op.input })
          .then((data) => {
            observer.next({ result: { type: 'data', data } });
            observer.complete();
          })
          .catch((cause) => {
            observer.error(TRPCClientError.from(cause as Error));
          });
      });
  };
  return link;
}
