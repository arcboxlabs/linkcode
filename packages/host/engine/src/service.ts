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

export function makeEngineLayer(
  transport: Transport,
  deps: EngineDeps = {},
): Layer.Layer<EngineService, EngineFailure> {
  return Layer.effect(
    EngineService,
    Effect.gen(function* () {
      const engine = yield* Effect.acquireRelease(
        createEngineRuntime(transport, deps),
        (runtime) => runtime.stop,
      );
      yield* engine.start;
      return { ensureChatWorkspace: engine.ensureChatWorkspace };
    }),
  );
}
