import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  MessageId,
  Schedule,
  ScheduleId,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import { SessionResourceIdSchema, textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { InMemoryResourceStore } from '../resource/resource-store';
import { createTestEngine } from './fixtures/test-engine';

/** Adapter that answers a prompt turn by emitting one assistant chunk and a stop. */
class ScheduleFakeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly capabilities: AgentCapabilities = { slashCommands: false, shellCommand: false };
  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: false,
    resume: false,
  };
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly promptInputs: AgentInput[]) {}

  start(): Promise<void> {
    return Promise.resolve();
  }

  startCatalog() {
    return Promise.resolve({ models: [], policies: [] });
  }

  send(input: AgentInput): Promise<void> {
    if (input.type === 'prompt') {
      this.promptInputs.push(structuredClone(input));
      this.emit({
        type: 'agent-message-chunk',
        messageId: 'm1' as MessageId,
        content: textBlock('scheduled work done'),
      });
      this.emit({ type: 'stop', stopReason: 'end_turn' });
    }
    return Promise.resolve();
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  listHistory(): Promise<AgentHistoryListResult> {
    return Promise.resolve({ sessions: [] });
  }

  readHistory(): Promise<AgentHistoryReadResult> {
    return Promise.reject(new Error('no history'));
  }

  resumeHistory(): Promise<void> {
    return Promise.reject(new Error('no history'));
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

function pick<K extends WirePayload['kind']>(
  sent: WirePayload[],
  kind: K,
  replyTo?: string,
): Extract<WirePayload, { kind: K }> {
  const found = sent.find(
    (p): p is Extract<WirePayload, { kind: K }> =>
      p.kind === kind && (replyTo === undefined || ('replyTo' in p && p.replyTo === replyTo)),
  );
  return nullthrow(found, `no ${kind} payload`);
}

function harness() {
  const sent: WirePayload[] = [];
  const promptInputs: AgentInput[] = [];
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
  const conversationStore = new InMemoryConversationStore();
  const resourceStore = new InMemoryResourceStore();
  const factory: AdapterFactory = () => new ScheduleFakeAdapter(promptInputs);
  const engine = createTestEngine(transport, { factory, conversationStore, resourceStore });

  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await wait(0);
    }
  }
  return { engine, sent, promptInputs, conversationStore, resourceStore, inject, settle };
}

const SPEC = {
  prompt: 'summarize the day',
  cadence: { type: 'interval' as const, everyMs: 60000 },
  target: { type: 'new-session' as const, config: { kind: 'claude-code' as const, cwd: '/repo' } },
};

describe('engine schedule wiring', () => {
  it('creates and lists a schedule over the wire', async () => {
    const h = harness();
    await h.engine.start();
    h.inject({ kind: 'schedule.create', clientReqId: 'c1', spec: SPEC });
    await h.settle();

    const schedule = pick(h.sent, 'schedule.created', 'c1').schedule;
    expect(schedule.status).toBe('active');

    h.inject({ kind: 'schedule.list', clientReqId: 'c2' });
    await h.settle();
    const schedules = pick(h.sent, 'schedule.listed', 'c2').schedules;
    expect(schedules.map((s: Schedule) => s.scheduleId)).toContain(schedule.scheduleId);
  });

  it('run-once drives a hidden automation session to completion', async () => {
    const h = harness();
    await h.engine.start();
    h.inject({ kind: 'schedule.create', clientReqId: 'c1', spec: SPEC });
    await h.settle();
    const scheduleId = pick(h.sent, 'schedule.created', 'c1').schedule.scheduleId;

    h.inject({ kind: 'schedule.run-once', clientReqId: 'c2', scheduleId });
    await h.settle();

    // The run settled successfully with a summary lifted from the assistant turn.
    const run = h.sent.flatMap((p) => (p.kind === 'schedule.run' ? [p.run] : [])).at(-1);
    expect(run?.status).toBe('succeeded');
    expect(run?.trigger).toBe('manual');
    expect(run?.summary).toBe('scheduled work done');

    // The session it ran in is tagged and kept (cold) — listed with its automation attribution.
    h.inject({ kind: 'session.list', clientReqId: 'c3' });
    await h.settle();
    const automationSession = pick(h.sent, 'session.listed', 'c3').sessions.find(
      (s) => s.automation !== undefined,
    );
    expect(automationSession?.automation).toEqual({ kind: 'schedule', id: scheduleId });
    expect(automationSession?.status).toBe('stopped');
  });

  it('records an existing-session schedule prompt as a completed turn', async () => {
    const h = harness();
    await h.engine.start();
    h.inject({
      kind: 'session.start',
      clientReqId: 'session',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    await h.settle();
    const sessionId = pick(h.sent, 'session.started', 'session').sessionId;
    const sourceUrl = 'https://example.com/reference';
    await h.resourceStore.save(
      {
        resourceId: SessionResourceIdSchema.parse('resource-source'),
        sessionId,
        direction: 'source',
        name: 'Reference',
        kind: 'link',
        status: 'ready',
        locator: { type: 'url', url: sourceUrl },
        createdAt: 1,
        updatedAt: 1,
      },
      sourceUrl,
    );

    h.inject({
      kind: 'schedule.create',
      clientReqId: 'create',
      spec: { ...SPEC, target: { type: 'session', sessionId } },
    });
    await h.settle();
    const scheduleId = pick(h.sent, 'schedule.created', 'create').schedule.scheduleId;
    h.inject({ kind: 'schedule.run-once', clientReqId: 'run', scheduleId });
    await h.settle();

    const [turn] = await h.conversationStore.listTurns(sessionId);
    expect(turn).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 1,
      state: 'completed',
      input: { type: 'prompt' },
    });
    if (turn.input.type !== 'prompt') throw new Error('expected a prompt turn');
    expect((await h.conversationStore.getPrompt(nullthrow(turn.input.promptId)))?.blocks).toEqual([
      { type: 'text', text: SPEC.prompt },
    ]);
    expect(await h.conversationStore.listOpenOperations(sessionId)).toHaveLength(0);
    expect(h.promptInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: SPEC.prompt }] },
    ]);
    expect(h.sent).toContainEqual({
      kind: 'conversation.graph.changed',
      sessionId,
      graphRevision: 1,
      activeLeafTurnId: turn.turnId,
    });
    expect(
      h.sent.filter(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'user-message',
          messageId: `msg-${turn.turnId}`,
        }),
      }),
    ]);
  });

  it('reports an unknown schedule as not found', async () => {
    const h = harness();
    await h.engine.start();

    h.inject({
      kind: 'schedule.run-once',
      clientReqId: 'missing',
      scheduleId: 'schedule-missing' as ScheduleId,
    });
    await h.settle();

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'missing',
      code: 'not_found',
      message: 'Schedule not found',
    });
  });

  it('reports an invalid cron cadence as an invalid request', async () => {
    const h = harness();
    await h.engine.start();

    h.inject({
      kind: 'schedule.create',
      clientReqId: 'invalid-cron',
      spec: { ...SPEC, cadence: { type: 'cron', expression: 'nope' } },
    });
    await h.settle();

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'invalid-cron',
      code: 'invalid_request',
      message: 'Invalid schedule cadence',
    });
  });
});
