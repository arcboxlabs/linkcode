import { z } from 'zod';

/**
 * TypeSafe IPC 仅承载系统 / UI 能力，**绝不承载业务数据**（PLAN §2.3 / §4.5）。
 * SystemContext 是这些能力的实现注入点：由 Electron 主进程提供真实实现，
 * 抽象层（tRPC router）与之解耦，因此本包不依赖 electron。
 */
export interface SystemContext {
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): boolean;
  };
  dialog: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    getVersion(): string;
    getPlatform(): string;
  };
}

export const PickFileOptionsSchema = z.object({
  title: z.string().optional(),
  /** 是否选择目录而非文件。 */
  directory: z.boolean().optional(),
});
export type PickFileOptions = z.infer<typeof PickFileOptionsSchema>;

/** 渲染层 → 主进程 的一次调用信封（IPC 传输边界格式）。 */
export interface IpcCallEnvelope {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  input: unknown;
}

/** 渲染层注入的传输函数：把一次调用送到主进程并拿回结果。 */
export type IpcInvoke = (call: IpcCallEnvelope) => Promise<unknown>;
