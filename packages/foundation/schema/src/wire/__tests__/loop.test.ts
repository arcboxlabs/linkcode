import { describe, expect, it } from 'vitest';
import type { LoopIteration, LoopLogEntry, LoopRecord, LoopSpec } from '../../model/loop';
import type { MessageId } from '../../model/primitives';
import type { WirePayload } from '../index';
import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '../index';

function envelope(payload: WirePayload) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'msg-1' as MessageId, ts: 0, payload };
}

const spec: LoopSpec = {
  kind: 'claude-code',
  cwd: '/repo',
  prompt: 'make the test suite pass',
  verifyChecks: ['pnpm test'],
  maxIterations: 10,
  sleepMs: 0,
};

const loop: LoopRecord = {
  loopId: 'loop-1' as LoopRecord['loopId'],
  spec,
  status: 'running',
  iterationCount: 0,
  startedAt: 0,
  updatedAt: 0,
};

const iteration: LoopIteration = {
  loopId: loop.loopId,
  index: 0,
  status: 'running',
  checks: [{ command: 'pnpm test', exitCode: 1, outputTail: '1 failing' }],
  startedAt: 0,
};

const log: LoopLogEntry = {
  seq: 0,
  ts: 0,
  level: 'info',
  source: 'system',
  message: 'loop started',
};

describe('loop wire variants', () => {
  it('round-trips every request/reply/broadcast kind', () => {
    const payloads: WirePayload[] = [
      { kind: 'loop.start', clientReqId: 'c1', spec },
      { kind: 'loop.started', replyTo: 'c1', loop },
      { kind: 'loop.stop', clientReqId: 'c2', loopId: loop.loopId },
      { kind: 'loop.delete', clientReqId: 'c3', loopId: loop.loopId },
      { kind: 'loop.list', clientReqId: 'c4' },
      { kind: 'loop.listed', replyTo: 'c4', loops: [loop] },
      { kind: 'loop.inspect', clientReqId: 'c5', loopId: loop.loopId },
      { kind: 'loop.inspected', replyTo: 'c5', loop, iterations: [iteration], logs: [log] },
      { kind: 'loop.changed', loop },
      { kind: 'loop.removed', loopId: loop.loopId },
      { kind: 'loop.iteration', iteration },
      { kind: 'loop.log', loopId: loop.loopId, entry: log },
    ];
    for (const payload of payloads) {
      expect(parseWireMessage(envelope(payload)).success, payload.kind).toBe(true);
    }
  });

  it('rejects a spec with no verification mechanism', () => {
    const payload: WirePayload = {
      kind: 'loop.start',
      clientReqId: 'c1',
      spec: { ...spec, verifyChecks: [] },
    };
    expect(parseWireMessage(envelope(payload)).success).toBe(false);
  });
});
