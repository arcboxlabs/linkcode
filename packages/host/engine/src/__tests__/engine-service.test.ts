import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Transport } from '@linkcode/transport';
import { Effect, ManagedRuntime } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { EngineService, makeEngineLayer } from '../service';

describe('engine service', () => {
  it('owns the engine lifecycle and exposes workspace orchestration', async () => {
    let connects = 0;
    let closes = 0;
    const transport: Transport = {
      connect() {
        connects += 1;
        return Promise.resolve();
      },
      send(message) {
        void message;
      },
      onMessage() {
        return noop;
      },
      onClose() {
        return noop;
      },
      close() {
        closes += 1;
      },
    };
    const runtime = ManagedRuntime.make(makeEngineLayer(transport));
    const root = await mkdtemp(join(tmpdir(), 'linkcode-engine-service-'));
    const chatRoot = join(root, 'chat');

    try {
      const engine = await runtime.runPromise(Effect.service(EngineService));
      const workspace = await runtime.runPromise(engine.ensureChatWorkspace(chatRoot));

      expect(connects).toBe(1);
      expect(workspace.cwd).toBe(chatRoot);
    } finally {
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }

    expect(closes).toBe(1);
  });
});
