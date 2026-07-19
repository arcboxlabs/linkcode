import type { WorkspaceRecord } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Context, Effect, Layer } from 'effect';
import type { EngineDeps } from './deps';
import { createEngineRuntime } from './engine';

export class EngineService extends Context.Service<
  EngineService,
  {
    readonly ensureChatWorkspace: (cwd: string) => Effect.Effect<WorkspaceRecord>;
  }
>()('@linkcode/engine/Engine') {}

export function makeEngineLayer(
  transport: Transport,
  deps: EngineDeps = {},
): Layer.Layer<EngineService> {
  return Layer.effect(
    EngineService,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const engine = createEngineRuntime(transport, deps);
        yield* Effect.promise(() => engine.start());
        return engine;
      }),
      (engine) =>
        Effect.promise(() => engine.stop()).pipe(
          Effect.catchCause((cause) =>
            Effect.logError('[linkcode/engine] error during shutdown', cause),
          ),
        ),
    ).pipe(
      Effect.map((engine) => ({
        ensureChatWorkspace: Effect.fn('Engine.ensureChatWorkspace')(function* (cwd: string) {
          return yield* Effect.promise(() => engine.ensureChatWorkspace(cwd));
        }),
      })),
    ),
  );
}
