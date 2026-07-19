import type { Transport } from '@linkcode/transport';
import { Effect, ManagedRuntime } from 'effect';
import type { EngineDeps } from '../../engine';
import { EngineService, makeEngineLayer } from '../../service';

export function createTestEngine(transport: Transport, deps: EngineDeps = {}) {
  const runtime = ManagedRuntime.make(makeEngineLayer(transport, deps));
  return {
    async start(): Promise<void> {
      await runtime.runPromise(Effect.service(EngineService));
    },
    stop(): Promise<void> {
      return runtime.dispose();
    },
  };
}
