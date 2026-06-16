import type { PickFileOptions } from './context';

/**
 * SystemBridge：TypeSafe IPC 的能力契约（PLAN §6）——仅系统 / UI 能力。
 * 业务数据一律走 transport，**禁止经此通道**（PLAN §2.3）。
 *
 * 默认实现为 tRPC：渲染层通过 `createTRPCClient<SystemRouter>({ links: [ipcLink(...)] })`
 * 获得与本接口等价的、端到端类型安全的调用代理。本接口作为能力清单与替代实现的参照。
 */
export interface SystemBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
  fs: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
  };
}
