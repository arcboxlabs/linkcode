import type {
  LoopId,
  LoopIteration,
  LoopLogEntry,
  LoopRecord,
  WirePayload,
} from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { LoopEvent } from '../../src/client';
import { createConnectedLocalClient } from '../support/local-client';

const loop: LoopRecord = {
  loopId: 'loop-1' as LoopId,
  spec: {
    kind: 'claude-code',
    cwd: '/repo',
    prompt: 'make tests pass',
    verifyChecks: ['pnpm test'],
    maxIterations: 10,
    sleepMs: 0,
  },
  status: 'running',
  iterationCount: 0,
  startedAt: 0,
  updatedAt: 0,
};

const iteration: LoopIteration = {
  loopId: loop.loopId,
  index: 0,
  status: 'running',
  checks: [],
  startedAt: 0,
};

function logEntry(seq: number, message: string): LoopLogEntry {
  return { seq, ts: seq, level: 'info', source: 'system', message };
}

describe('LinkCodeClient loop API', () => {
  it('correlates start/list/inspect replies and acks mutations', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      const reply = ((): WirePayload | undefined => {
        switch (p.kind) {
          case 'loop.start':
            return { kind: 'loop.started', replyTo: p.clientReqId, loop };
          case 'loop.list':
            return { kind: 'loop.listed', replyTo: p.clientReqId, loops: [loop] };
          case 'loop.inspect':
            return {
              kind: 'loop.inspected',
              replyTo: p.clientReqId,
              loop,
              iterations: [iteration],
              logs: [logEntry(0, 'loop started')],
            };
          case 'loop.stop':
          case 'loop.delete':
            return { kind: 'request.succeeded', replyTo: p.clientReqId };
          default:
            return undefined;
        }
      })();
      if (reply) serverTransport.send(createWireMessage(reply));
    });

    await expect(client.startLoop(loop.spec)).resolves.toEqual(loop);
    await expect(client.listLoops()).resolves.toEqual([loop]);
    await expect(client.inspectLoop(loop.loopId)).resolves.toEqual({
      loop,
      iterations: [iteration],
      logs: [logEntry(0, 'loop started')],
    });
    await expect(client.stopLoop(loop.loopId)).resolves.toEqual({ ok: true });
    await expect(client.deleteLoop(loop.loopId)).resolves.toEqual({ ok: true });

    client.dispose();
    serverTransport.close();
  });

  it('fans loop broadcasts out until unsubscribed', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const events: LoopEvent[] = [];
    const unsubscribe = client.subscribeLoopEvents((event) => events.push(event));

    const send = (payload: WirePayload) => serverTransport.send(createWireMessage(payload));
    send({ kind: 'loop.changed', loop });
    send({ kind: 'loop.iteration', iteration });
    await Promise.resolve();
    await Promise.resolve();
    unsubscribe();
    send({ kind: 'loop.removed', loopId: loop.loopId });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      { type: 'changed', loop },
      { type: 'iteration', iteration },
    ]);

    client.dispose();
    serverTransport.close();
  });

  it('folds the loop log buffer: seed + live tail, deduped by seq with a stable snapshot', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind === 'loop.inspect') {
        serverTransport.send(
          createWireMessage({
            kind: 'loop.inspected',
            replyTo: p.clientReqId,
            loop,
            iterations: [],
            logs: [logEntry(0, 'a'), logEntry(1, 'b')],
          }),
        );
      }
    });

    let notified = 0;
    const unsubscribe = client.subscribeLoopLog(loop.loopId, () => {
      notified += 1;
    });

    const before = client.loopLogSnapshot(loop.loopId);
    expect(before).toEqual([]);

    await client.inspectLoop(loop.loopId);
    const seeded = client.loopLogSnapshot(loop.loopId);
    expect(seeded.map((e) => e.message)).toEqual(['a', 'b']);
    // Snapshot identity is stable across reads with no change.
    expect(client.loopLogSnapshot(loop.loopId)).toBe(seeded);

    const send = (payload: WirePayload) => serverTransport.send(createWireMessage(payload));
    send({ kind: 'loop.log', loopId: loop.loopId, entry: logEntry(2, 'c') });
    // A duplicate seq is dropped.
    send({ kind: 'loop.log', loopId: loop.loopId, entry: logEntry(2, 'c-dup') });
    await Promise.resolve();
    await Promise.resolve();

    const after = client.loopLogSnapshot(loop.loopId);
    expect(after.map((e) => e.message)).toEqual(['a', 'b', 'c']);
    expect(after).not.toBe(seeded);
    expect(notified).toBeGreaterThan(0);

    unsubscribe();
    client.dispose();
    serverTransport.close();
  });
});
