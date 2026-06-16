import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { IpcInvoke } from './context';
import type { SystemRouter } from './router';

/**
 * ipcLink：渲染层 tRPC 客户端的终结 link，把 operation 经注入的 `invoke`
 * 送到主进程。承载（Electron ipcRenderer.invoke 等）由调用方注入，
 * 因此本包与 electron 解耦。
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
