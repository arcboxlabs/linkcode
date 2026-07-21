import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentRuntimes,
  AgentStartCatalog,
  SessionId,
  StartOptions,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import type { ProviderConfigStore } from '../../agent/provider-config';
import type { SessionStore } from '../../session/session-store';
import { InMemorySessionStore } from '../../session/session-store';
import type { WorkspaceStore } from '../../workspace/workspace-store';
import { createTestEngine } from './test-engine';

export class FakeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly capabilities: AgentCapabilities = { slashCommands: false, shellCommand: false };
  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
  };

  startedWith: StartOptions | null = null;
  resumedFrom: string | null = null;
  stopped = false;
  readonly sentInputs: AgentInput[] = [];
  private readonly listeners = new Set<(event: AgentEvent) => void>();

  start(opts: StartOptions): Promise<void> {
    this.startedWith = opts;
    return Promise.resolve();
  }

  startCatalog(): Promise<AgentStartCatalog> {
    return Promise.resolve({ models: [], policies: [] });
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

  send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return Promise.resolve();
  }

  onEvent(cb: (event: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

/** Let the fire-and-forget handle()/persist chains settle. */
export function settleEngineTasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createSessionHarness(
  store: SessionStore = new InMemorySessionStore(),
  makeAdapter: () => FakeAdapter = () => new FakeAdapter(),
  collectAgentRuntimes?: () => Promise<AgentRuntimes>,
  agentRuntimesReady?: Promise<AgentRuntimes>,
  workspaceStore?: WorkspaceStore,
  providerStore?: ProviderConfigStore,
) {
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
  const adapters: FakeAdapter[] = [];
  const factory: AdapterFactory = () => {
    const adapter = makeAdapter();
    adapters.push(adapter);
    return adapter;
  };
  const engine = createTestEngine(transport, {
    factory,
    sessionStore: store,
    collectAgentRuntimes,
    agentRuntimesReady,
    workspaceStore,
    providerStore,
  });

  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await settleEngineTasks();
  }

  return { engine, sent, inject, adapters, store };
}

export function startedSessionId(sent: WirePayload[], replyTo: string): SessionId {
  const started = sent.find(
    (payload) => payload.kind === 'session.started' && payload.replyTo === replyTo,
  );
  if (started?.kind !== 'session.started') throw new Error(`no session.started for ${replyTo}`);
  return started.sessionId;
}

export function listedSessions(sent: WirePayload[], replyTo: string) {
  const listed = sent.find(
    (payload) => payload.kind === 'session.listed' && payload.replyTo === replyTo,
  );
  if (listed?.kind !== 'session.listed') throw new Error(`no session.listed for ${replyTo}`);
  return listed.sessions;
}
