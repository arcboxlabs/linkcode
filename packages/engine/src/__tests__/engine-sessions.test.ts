import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  SessionId,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { InMemorySessionStore } from '../session-store';

class FakeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
  };

  startedWith: StartOptions | null = null;
  resumedFrom: string | null = null;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  start(opts: StartOptions): Promise<void> {
    this.startedWith = opts;
    return Promise.resolve();
  }

  listHistory(): Promise<AgentHistoryListResult> {
    return Promise.resolve({ sessions: [] });
  }

  readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.resolve({
      session: {
        historyId: opts.historyId,
        kind: this.kind,
        title: 'Imported title',
        cwd: '/imported',
        createdAt: 1111,
      },
      events: [],
    });
  }

  resumeHistory(opts: AgentHistoryResumeOptions): Promise<void> {
    this.resumedFrom = opts.historyId;
    return Promise.resolve();
  }

  send(_input: AgentInput): Promise<void> {
    return Promise.resolve();
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

/** Let the fire-and-forget handle()/persist chains settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function harness(store = new InMemorySessionStore()) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const adapters: FakeAdapter[] = [];
  const factory: AdapterFactory = () => {
    const adapter = new FakeAdapter();
    adapters.push(adapter);
    return adapter;
  };
  const engine = new Engine(transport, factory, undefined, undefined, store);

  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await tick();
  }

  return { engine, sent, inject, adapters, store };
}

function startedId(sent: WirePayload[], replyTo: string): SessionId {
  const started = sent.find((p) => p.kind === 'session.started' && p.replyTo === replyTo);
  if (started?.kind !== 'session.started') throw new Error(`no session.started for ${replyTo}`);
  return started.sessionId;
}

function listedSessions(sent: WirePayload[], replyTo: string) {
  const listed = sent.find((p) => p.kind === 'session.listed' && p.replyTo === replyTo);
  if (listed?.kind !== 'session.listed') throw new Error(`no session.listed for ${replyTo}`);
  return listed.sessions;
}

describe('engine session persistence', () => {
  it('persists created sessions with title and session-ref, and lists them cold after a restart', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('  Fix the   flaky\ntest  ')] },
    });

    const records = await store.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(sessionId);
    expect(records[0].origin).toEqual({ type: 'created' });
    expect(records[0].title).toBe('Fix the flaky test');
    expect(records[0].runs).toHaveLength(1);
    expect(records[0].runs[0].historyId).toBe('native-1');

    // A fresh engine over the same store lists the session cold.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.list', clientReqId: 'r3' });
    const sessions = listedSessions(second.sent, 'r3');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      status: 'stopped',
      title: 'Fix the flaky test',
      cwd: '/repo',
      historyId: 'native-1',
    });
  });

  it('resumes a persisted session under the same id, appending a run', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(second.sent, 'r3')).toBe(sessionId);
    expect(second.adapters[0].resumedFrom).toBe('native-1');

    const [record] = await store.load();
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0].endedAt).toBeTypeOf('number');
    expect(record.runs[1].historyId).toBe('native-1');
  });

  it('imports a provider history session as a cold record', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    const imported = sent.find((p) => p.kind === 'session.imported');
    if (imported?.kind !== 'session.imported') throw new Error('no session.imported reply');
    expect(imported.record).toMatchObject({
      kind: 'claude-code',
      cwd: '/imported',
      title: 'Imported title',
      origin: { type: 'imported', historyId: 'native-9' },
      createdAt: 1111,
      runs: [],
    });

    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')[0].status).toBe('stopped');
  });

  it('wakes a never-prompted session (no provider linkage) as a fresh start under the same id', async () => {
    const { engine, sent, inject, adapters } = harness();
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(sent, 'r1');
    await inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });
    await inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });

    expect(startedId(sent, 'r3')).toBe(sessionId);
    const resumed = adapters.at(-1);
    expect(resumed?.resumedFrom).toBeNull();
    expect(resumed?.startedWith).toMatchObject({ kind: 'claude-code', cwd: '/repo' });
  });
});
