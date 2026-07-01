import type { AdapterFactory } from '@linkcode/agent-adapter';
import { BaseAgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentKind,
  ContentBlock,
  MessageId,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { trueFn } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { HistoryService } from '../history-service';

interface FakeState {
  listCalls: number;
  readCalls: number;
  resumeCalls: number;
}

const historyId = 'hist-1' as AgentHistoryId;

function historySession(updatedAt = 1) {
  return {
    historyId,
    kind: 'codex' as const,
    title: 'Fixture history',
    cwd: '/repo',
    updatedAt,
    messageCount: 2,
    metadata: { fileSize: 100, transcriptPath: '/tmp/transcript.jsonl' },
  };
}

function historyEvents(): AgentHistoryEvent[] {
  return [
    {
      historyId,
      itemId: 'u1',
      event: {
        type: 'user-message' as const,
        messageId: 'u1' as MessageId,
        content: [{ type: 'text' as const, text: 'hello' }],
      },
    },
    {
      historyId,
      itemId: 'a1',
      event: {
        type: 'agent-message-chunk' as const,
        messageId: 'a1' as MessageId,
        content: { type: 'text' as const, text: 'world' },
      },
    },
  ];
}

class FakeHistoryAdapter extends BaseAgentAdapter {
  readonly kind: AgentKind;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  constructor(
    kind: AgentKind,
    private readonly state: FakeState,
  ) {
    super();
    this.kind = kind;
  }

  override listHistory(_opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    this.state.listCalls += 1;
    return Promise.resolve({ sessions: [historySession(this.state.listCalls)] });
  }

  override readHistory(_opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    this.state.readCalls += 1;
    return Promise.resolve({
      session: historySession(this.state.readCalls),
      events: historyEvents(),
    });
  }

  override async resumeHistory(
    _opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.state.resumeCalls += 1;
    await this.start(startOpts);
  }

  protected onStart(_opts: StartOptions): Promise<void> {
    return Promise.resolve();
  }

  protected onPrompt(_content: ContentBlock[]): Promise<void> {
    this.emitAssistantText('ok', 'm1' as MessageId);
    return Promise.resolve();
  }
}

function fakeFactory(state: FakeState): AdapterFactory {
  return (kind) => new FakeHistoryAdapter(kind, state);
}

describe('HistoryService', () => {
  it('caches list results until forceRefresh', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeFactory(state), { ttlMs: 60000 });

    await service.list('codex', { cwd: '/repo', limit: 10 });
    await service.list('codex', { cwd: '/repo', limit: 10 });
    expect(state.listCalls).toBe(1);

    await service.list('codex', { cwd: '/repo', limit: 10, forceRefresh: true });
    expect(state.listCalls).toBe(2);
  });

  it('caches converted events and paginates from memory', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeFactory(state), { ttlMs: 60000 });

    const first = await service.read('codex', { historyId, limit: 1 });
    const second = await service.read('codex', { historyId, cursor: first.cursor, limit: 1 });

    expect(state.readCalls).toBe(1);
    expect(first.events).toHaveLength(1);
    expect(first.cursor).toBe('1');
    expect(second.events[0]?.itemId).toBe('a1');

    await service.read('codex', { historyId, limit: 1, forceRefresh: true });
    expect(state.readCalls).toBe(2);
  });
});

describe('Engine history wire API', () => {
  it('lists, reads, and resumes history over transport', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const [clientTransport, engineTransport] = createLocalTransportPair();
    const engine = new Engine(engineTransport, fakeFactory(state));
    const received: WireMessage[] = [];

    clientTransport.onMessage((msg) => received.push(msg));
    await clientTransport.connect();
    await engine.start();

    clientTransport.send(
      createWireMessage({
        kind: 'history.list',
        clientReqId: 'list-1',
        agentKind: 'codex',
        opts: { limit: 1 },
      }),
    );
    const listed = await waitForPayload(received, 'history.listed');
    expect(listed.replyTo).toBe('list-1');
    expect(listed.result.sessions[0]?.historyId).toBe(historyId);

    clientTransport.send(
      createWireMessage({
        kind: 'history.read',
        clientReqId: 'read-1',
        agentKind: 'codex',
        opts: { historyId, limit: 1 },
      }),
    );
    const read = await waitForPayload(received, 'history.read.result');
    expect(read.replyTo).toBe('read-1');
    expect(read.result.events[0]?.itemId).toBe('u1');

    clientTransport.send(
      createWireMessage({
        kind: 'history.resume',
        clientReqId: 'resume-1',
        agentKind: 'codex',
        historyId,
        startOpts: { kind: 'codex', cwd: '/repo' },
      }),
    );
    const started = await waitForPayload(received, 'session.started');
    expect(started.replyTo).toBe('resume-1');
    expect(state.resumeCalls).toBe(1);

    clientTransport.send(
      createWireMessage({
        kind: 'agent.input',
        clientReqId: 'input-1',
        sessionId: started.sessionId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    const inputAck = await waitForPayload(
      received,
      'request.succeeded',
      (payload) => payload.replyTo === 'input-1',
    );
    expect(inputAck.replyTo).toBe('input-1');

    clientTransport.send(
      createWireMessage({
        kind: 'session.stop',
        clientReqId: 'stop-1',
        sessionId: started.sessionId,
      }),
    );
    const stopAck = await waitForPayload(
      received,
      'request.succeeded',
      (payload) => payload.replyTo === 'stop-1',
    );
    expect(stopAck.replyTo).toBe('stop-1');

    engine.stop();
    clientTransport.close();
  });
});

function waitForPayload<K extends WirePayload['kind']>(
  messages: WireMessage[],
  kind: K,
  predicate: (payload: Extract<WirePayload, { kind: K }>) => boolean = trueFn,
): Promise<Extract<WirePayload, { kind: K }>> {
  const existing = messages.find((msg) => {
    if (msg.payload.kind !== kind) return false;
    return predicate(msg.payload as Extract<WirePayload, { kind: K }>);
  });
  if (existing) return Promise.resolve(existing.payload as Extract<WirePayload, { kind: K }>);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${kind}`)), 500);
    const poll = (): void => {
      const found = messages.find((msg) => {
        if (msg.payload.kind !== kind) return false;
        return predicate(msg.payload as Extract<WirePayload, { kind: K }>);
      });
      if (found) {
        clearTimeout(timeout);
        resolve(found.payload as Extract<WirePayload, { kind: K }>);
      } else {
        setTimeout(poll, 0);
      }
    };
    poll();
  });
}
