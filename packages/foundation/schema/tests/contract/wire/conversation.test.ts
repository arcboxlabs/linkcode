import {
  deliveryOf,
  WIRE_PROTOCOL_VERSION,
  WireMessageSchema,
  WirePayloadSchema,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function parses(payload: unknown): boolean {
  return WireMessageSchema.safeParse({
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload,
  }).success;
}

const submitBase = {
  kind: 'turn.submit',
  clientReqId: 'request-1',
  sessionId: 'session-1',
  operationId: 'op-1',
  input: { type: 'prompt', blocks: [{ type: 'text', text: 'hello' }] },
};

describe('turn.submit parent/revision contract', () => {
  it('accepts a plain send: no parent, no revision', () => {
    expect(parses(submitBase)).toBe(true);
  });

  it('accepts an explicit parent with its revision guard', () => {
    expect(parses({ ...submitBase, parentTurnId: 'turn-1', expectedGraphRevision: 3 })).toBe(true);
  });

  it('accepts a root submit (parentTurnId null) with the revision guard', () => {
    expect(parses({ ...submitBase, parentTurnId: null, expectedGraphRevision: 0 })).toBe(true);
  });

  it('rejects an explicit parent without the revision guard', () => {
    expect(parses({ ...submitBase, parentTurnId: 'turn-1' })).toBe(false);
    expect(parses({ ...submitBase, parentTurnId: null })).toBe(false);
  });

  it('rejects a revision guard on a plain send', () => {
    expect(parses({ ...submitBase, expectedGraphRevision: 3 })).toBe(false);
  });

  it('rejects an empty prompt', () => {
    expect(parses({ ...submitBase, input: { type: 'prompt', blocks: [] } })).toBe(false);
  });

  it.each([
    { type: 'command', name: 'compact', arguments: '--all' },
    { type: 'shell-command', command: 'pnpm test' },
    { type: 'prompt', blocks: [{ type: 'attachment_ref', attachmentId: 'att-1' }] },
  ])('accepts the $type submit input', (input) => {
    expect(parses({ ...submitBase, input })).toBe(true);
  });
});

describe('conversation read/graph frames', () => {
  it('round-trips a graph result carrying turn summaries', () => {
    expect(
      parses({
        kind: 'conversation.graph.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        graphRevision: 2,
        activeLeafTurnId: 'turn-2',
        turns: [
          {
            turnId: 'turn-1',
            sessionId: 'session-1',
            parentTurnId: null,
            siblingOrdinal: 1,
            input: { type: 'prompt', promptId: 'prompt-1' },
            runId: 'run-1',
            state: 'completed',
            createdAt: 1,
          },
        ],
      }),
    ).toBe(true);
  });

  it('carries the watermark and attributed events on a read result', () => {
    expect(
      parses({
        kind: 'conversation.read.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        graphRevision: 2,
        leafTurnId: 'turn-2',
        watermark: { epoch: 3, seq: 41 },
        events: [
          {
            turnId: 'turn-2',
            runId: 'run-1',
            epoch: 3,
            seq: 40,
            event: { type: 'agent-message', messageId: 'm-1', content: [] },
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts an inputSummary on a graph turn', () => {
    expect(
      parses({
        kind: 'conversation.graph.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        graphRevision: 1,
        turns: [
          {
            turnId: 'turn-1',
            sessionId: 'session-1',
            parentTurnId: null,
            siblingOrdinal: 1,
            input: { type: 'prompt', promptId: 'prompt-1' },
            runId: 'run-1',
            state: 'completed',
            createdAt: 1,
            inputSummary: 'hello there',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts a non-final page: no watermark, cursor set, placeholder items allowed', () => {
    expect(
      parses({
        kind: 'conversation.read.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        graphRevision: 2,
        leafTurnId: 'turn-2',
        events: [
          {
            turnId: 'turn-1',
            runId: 'run-1',
            event: { type: 'user-message', messageId: 'm-1', content: [] },
          },
          { type: 'history-unavailable', turnId: 'turn-1', runId: 'run-1' },
        ],
        cursor: '2',
      }),
    ).toBe(true);
  });

  it('rejects a read item that is neither an event nor a placeholder', () => {
    expect(
      parses({
        kind: 'conversation.read.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        graphRevision: 0,
        events: [{ turnId: 'turn-1' }],
      }),
    ).toBe(false);
  });

  it('scopes conversation.graph.changed to its session', () => {
    const payload = WirePayloadSchema.parse({
      kind: 'conversation.graph.changed',
      sessionId: 'session-1',
      graphRevision: 4,
    });
    expect(payload.kind).toBe('conversation.graph.changed');
    // The delivery table, not just the payload shape: attached clients of OTHER sessions must
    // never receive another thread's graph moves.
    const delivery = deliveryOf(payload);
    if (delivery?.scope !== 'session') throw new Error('expected session-scoped delivery');
    expect(delivery.sessionId(payload)).toBe('session-1');
  });
});

describe('agent.event turn attribution', () => {
  it('accepts the optional runId/turnId/epoch/seq envelope fields', () => {
    expect(
      parses({
        kind: 'agent.event',
        sessionId: 'session-1',
        runId: 'run-1',
        turnId: 'turn-1',
        epoch: 2,
        seq: 17,
        event: { type: 'status', status: 'running' },
      }),
    ).toBe(true);
  });
});
