import { initTRPC } from '@trpc/server';
import { type IpcCallEnvelope, PickFileOptionsSchema, type SystemContext } from './context';

/**
 * systemRouter: the **default tRPC implementation** of TypeSafe IPC (PLAN §4.5 / §6).
 * tRPC is just one of the default implementations and is replaceable (PLAN §2.5).
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
 * On the main-process side, dispatch a single IPC call to the SystemContext implementation by path.
 * The path looks like `window.minimize` / `fs.pickFile`.
 * This is the IPC transport boundary, and the path is resolved dynamically, so a controlled `unknown` cast is used.
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
