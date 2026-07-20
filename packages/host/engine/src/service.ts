import type { WorkspaceRecord } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Context, Effect, Layer } from 'effect';
import type { EngineDeps } from './deps';
import { createEngineRuntime } from './engine';
import type { EngineFailure } from './failure';

export class EngineService extends Context.Service<
  EngineService,
  {
    readonly ensureChatWorkspace: (cwd: string) => Effect.Effect<WorkspaceRecord, EngineFailure>;
  }
>()('@linkcode/engine/Engine') {}

/** Daemon-owned infrastructure supplied at the Engine package boundary. */
export class EngineInfrastructure extends Context.Service<
  EngineInfrastructure,
  {
    readonly transport: Transport;
    readonly deps: EngineDeps;
  }
>()('@linkcode/engine/Infrastructure') {}

/** Engine feature assembly. The runtime, root scope, and root FiberSet are created exactly once. */
export const EngineLive: Layer.Layer<EngineService, EngineFailure, EngineInfrastructure> =
  Layer.effect(
    EngineService,
    Effect.gen(function* () {
      const { transport, deps } = yield* EngineInfrastructure;
      const engine = yield* Effect.acquireRelease(
        createEngineRuntime(transport, deps),
        (runtime) => runtime.stop,
      );
      yield* engine.start;
      return { ensureChatWorkspace: engine.ensureChatWorkspace };
    }),
  );

export function makeEngineInfrastructureLayer(
  transport: Transport,
  deps: EngineDeps = {},
): Layer.Layer<EngineInfrastructure> {
  return Layer.succeed(EngineInfrastructure, { transport, deps });
}

/** Convenience composition for tests and embedders that already hold concrete infrastructure. */
export function makeEngineLayer(
  transport: Transport,
  deps: EngineDeps = {},
): Layer.Layer<EngineService, EngineFailure> {
  return EngineLive.pipe(Layer.provide(makeEngineInfrastructureLayer(transport, deps)));
}
