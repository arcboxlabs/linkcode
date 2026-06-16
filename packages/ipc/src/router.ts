import { initTRPC } from '@trpc/server';
import { type IpcCallEnvelope, PickFileOptionsSchema, type SystemContext } from './context';

/**
 * systemRouter：TypeSafe IPC 的 **tRPC 默认实现**（PLAN §4.5 / §6）。
 * tRPC 只是默认实现之一，可替换（PLAN §2.5）。
 */
const t = initTRPC.context<SystemContext>().create();

export const systemRouter = t.router({
  window: t.router({
    minimize: t.procedure.mutation(({ ctx }) => {
      ctx.window.minimize();
    }),
    toggleMaximize: t.procedure.mutation(({ ctx }) => {
      ctx.window.toggleMaximize();
    }),
    close: t.procedure.mutation(({ ctx }) => {
      ctx.window.close();
    }),
    isMaximized: t.procedure.query(({ ctx }) => ctx.window.isMaximized()),
  }),
  app: t.router({
    version: t.procedure.query(({ ctx }) => ctx.app.getVersion()),
    platform: t.procedure.query(({ ctx }) => ctx.app.getPlatform()),
  }),
  fs: t.router({
    pickFile: t.procedure
      .input(PickFileOptionsSchema.optional())
      .mutation(({ ctx, input }) => ctx.dialog.pickFile(input)),
  }),
});

export type SystemRouter = typeof systemRouter;

const createCaller = t.createCallerFactory(systemRouter);

/**
 * 在主进程侧按 path 派发一次 IPC 调用到 SystemContext 实现。
 * path 形如 `window.minimize` / `fs.pickFile`。
 * 这里是 IPC 传输边界，path 走动态解析，故用受控的 unknown 转型。
 */
export async function dispatchSystemCall(
  ctx: SystemContext,
  call: IpcCallEnvelope,
): Promise<unknown> {
  type CallNode = Record<string, unknown>;
  const caller = createCaller(ctx) as unknown as CallNode;
  const fn = call.path.split('.').reduce<CallNode>((node, key) => node[key] as CallNode, caller);
  return (fn as unknown as (input: unknown) => Promise<unknown>)(call.input);
}
