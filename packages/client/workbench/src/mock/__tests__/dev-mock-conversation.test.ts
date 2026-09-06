import type { ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import { OperationIdSchema, SessionIdSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import { DevMockHost } from '../dev-mock-host';

function createHost() {
  const sent: WirePayload[] = [];
  let handler: ((msg: ValidatedWireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: ValidatedWireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const host = new DevMockHost(transport);
  host.start();

  async function request(payload: WirePayload, replyTo: string): Promise<WirePayload> {
    if (!handler) throw new Error('mock host not subscribed');
    handler(createWireMessage(payload));
    for (let i = 0; i < 100; i++) {
      // eslint-disable-next-line no-await-in-loop -- polling for the mock's latency-delayed reply.
      await wait(50);
      const reply = sent.find((p) => 'replyTo' in p && p.replyTo === replyTo);
      if (reply) return reply;
    }
    throw new Error(`no reply for ${replyTo}`);
  }

  return { sent, request };
}

describe('dev mock host conversation parity', () => {
  it('answers turn.submit, graph.get, and read coherently', async () => {
    const { request } = createHost();
    const started = await request(
      { kind: 'session.start', clientReqId: 'r1', opts: { kind: 'claude-code', cwd: '/mock' } },
      'r1',
    );
    if (started.kind !== 'session.started') throw new Error('session did not start');
    const sessionId = started.sessionId;

    const submitted = await request(
      {
        kind: 'turn.submit',
        clientReqId: 's1',
        sessionId,
        operationId: OperationIdSchema.parse('op-mock-1'),
        input: { type: 'shell-command', command: 'ls' },
      },
      's1',
    );
    if (submitted.kind !== 'turn.submitted') throw new Error('turn was not submitted');

    const graph = await request(
      { kind: 'conversation.graph.get', clientReqId: 'g1', sessionId },
      'g1',
    );
    if (graph.kind !== 'conversation.graph.result') throw new Error('no graph result');
    expect(graph.turns).toHaveLength(1);
    expect(graph.activeLeafTurnId).toBe(submitted.turnId);
    expect(graph.turns[0]).toMatchObject({
      turnId: submitted.turnId,
      parentTurnId: null,
      siblingOrdinal: 1,
      state: 'completed',
      inputSummary: '$ ls',
    });

    const read = await request({ kind: 'conversation.read', clientReqId: 'c1', sessionId }, 'c1');
    if (read.kind !== 'conversation.read.result') throw new Error('no read result');
    expect(read.watermark).toBeDefined();
    expect(read.cursor).toBeUndefined();
    // The attach replay precedes the turn in the journal; the echo is the turn's first frame.
    const rowIndex = read.events.findIndex(
      (item) => 'event' in item && item.event.type === 'user-message',
    );
    const userRow = read.events[rowIndex];
    if (!('event' in userRow) || userRow.event.type !== 'user-message') {
      throw new Error('expected a user row');
    }
    const placeholder = read.events[rowIndex + 1];
    expect(userRow.event.content).toEqual([{ type: 'text', text: '$ ls' }]);
    // Deterministic like the daemon: a re-read converges on the same row identity.
    expect(userRow.event.messageId).toBe(`msg-${submitted.turnId}`);
    expect(placeholder).toMatchObject({
      type: 'history-unavailable',
      turnId: submitted.turnId,
    });
    // The row is the stamped echo itself, and the watermark is the session's last position.
    expect(userRow).toMatchObject({ turnId: submitted.turnId, epoch: 0 });
    expect(read.watermark).toEqual({ epoch: 0, seq: userRow.seq });
  }, 15000);

  it('stamps every frame, records legacy prompts as turns, and replays them on a read', async () => {
    const { sent, request } = createHost();
    const started = await request(
      { kind: 'session.start', clientReqId: 'r1', opts: { kind: 'claude-code', cwd: '/mock' } },
      'r1',
    );
    if (started.kind !== 'session.started') throw new Error('session did not start');
    const sessionId = started.sessionId;

    await request(
      {
        kind: 'agent.input',
        clientReqId: 'p1',
        sessionId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'hello mock' }] },
      },
      'p1',
    );
    const frames = sent.filter(
      (payload) => payload.kind === 'agent.event' && payload.sessionId === sessionId,
    );
    // One epoch per launch, contiguous seqs: what the client's merge relies on.
    expect(frames.map((frame) => frame.kind === 'agent.event' && frame.epoch)).toEqual(
      frames.map(() => 0),
    );
    expect(frames.map((frame) => frame.kind === 'agent.event' && frame.seq)).toEqual(
      frames.map((_, index) => index + 1),
    );

    const graph = await request(
      { kind: 'conversation.graph.get', clientReqId: 'g1', sessionId },
      'g1',
    );
    if (graph.kind !== 'conversation.graph.result') throw new Error('no graph result');
    expect(graph.turns).toHaveLength(1);
    const [turn] = graph.turns;
    expect(turn).toMatchObject({ state: 'completed', input: { type: 'prompt' } });
    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: 'conversation.graph.changed',
        sessionId,
        graphRevision: 1,
        activeLeafTurnId: turn.turnId,
      }),
    );

    // A re-read reproduces exactly the frames the client already folded, under the same ids.
    const read = await request({ kind: 'conversation.read', clientReqId: 'c1', sessionId }, 'c1');
    if (read.kind !== 'conversation.read.result') throw new Error('no read result');
    expect(read.leafTurnId).toBe(turn.turnId);
    expect(read.events.filter((item) => 'event' in item)).toHaveLength(frames.length);
    expect(read.events).toContainEqual(
      expect.objectContaining({
        turnId: turn.turnId,
        event: expect.objectContaining({
          type: 'user-message',
          messageId: `msg-${turn.turnId}`,
        }),
      }),
    );
    expect(read.watermark).toEqual({ epoch: 0, seq: frames.length });

    // A relaunch mints under the next epoch.
    await request({ kind: 'session.stop', clientReqId: 'stop', sessionId }, 'stop');
    await request({ kind: 'session.resume', clientReqId: 'resume', sessionId }, 'resume');
    const resumed = sent.findLast(
      (payload) => payload.kind === 'agent.event' && payload.sessionId === sessionId,
    );
    expect(resumed).toMatchObject({ epoch: 1, seq: expect.any(Number) as number });
  }, 15000);

  it('fails loudly on parameters it would otherwise ignore', async () => {
    const { request } = createHost();
    const started = await request(
      { kind: 'session.start', clientReqId: 'r1', opts: { kind: 'claude-code', cwd: '/mock' } },
      'r1',
    );
    if (started.kind !== 'session.started') throw new Error('session did not start');
    const sessionId = started.sessionId;

    const pagedRead = await request(
      { kind: 'conversation.read', clientReqId: 'c-paged', sessionId, cursor: '1' },
      'c-paged',
    );
    expect(pagedRead.kind).toBe('request.failed');

    // An explicit-parent submit is admitted like the daemon's: a stale revision is a conflict.
    const staleSubmit = await request(
      {
        kind: 'turn.submit',
        clientReqId: 's-parent',
        sessionId,
        operationId: OperationIdSchema.parse('op-mock-parent'),
        input: { type: 'shell-command', command: 'ls' },
        parentTurnId: null,
        expectedGraphRevision: 7,
      },
      's-parent',
    );
    expect(staleSubmit).toMatchObject({ kind: 'request.failed', code: 'conflict' });
  }, 15000);

  it('fails loudly for conversation reads on unknown sessions', async () => {
    const { request } = createHost();
    const unknown = SessionIdSchema.parse('mock-sess-missing');
    const reply = await request(
      { kind: 'conversation.read', clientReqId: 'c-x', sessionId: unknown },
      'c-x',
    );
    expect(reply.kind).toBe('request.failed');
  }, 15000);
});
