import { type IpcCallEnvelope, type SystemRouter, ipcLink } from '@linkcode/ipc';
import { createTRPCClient } from '@trpc/client';

declare global {
  interface Window {
    linkcodeIpc: { invoke: (call: IpcCallEnvelope) => Promise<unknown> };
  }
}

/**
 * 系统桥客户端：TypeSafe IPC 的 tRPC 默认实现在渲染层的入口（PLAN §4.5）。
 * 端到端类型来自 SystemRouter；承载为 preload 暴露的 invoke 通道。
 */
export const systemBridge = createTRPCClient<SystemRouter>({
  links: [ipcLink((call) => window.linkcodeIpc.invoke(call))],
});
