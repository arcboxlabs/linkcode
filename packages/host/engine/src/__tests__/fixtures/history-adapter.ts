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
} from '@linkcode/schema';

export interface FakeHistoryState {
  listCalls: number;
  readCalls: number;
  resumeCalls: number;
}

export const historyId = 'hist-1' as AgentHistoryId;

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
        type: 'user-message',
        messageId: 'u1' as MessageId,
        content: [{ type: 'text', text: 'hello' }],
      },
    },
    {
      historyId,
      itemId: 'a1',
      event: {
        type: 'agent-message-chunk',
        messageId: 'a1' as MessageId,
        content: { type: 'text', text: 'world' },
      },
    },
  ];
}

export class FakeHistoryAdapter extends BaseAgentAdapter {
  readonly kind: AgentKind;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  constructor(
    kind: AgentKind,
    private readonly state: FakeHistoryState,
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

export class UnsupportedHistoryAdapter extends FakeHistoryAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: false,
    resume: false,
  };
}

export class RejectingHistoryAdapter extends FakeHistoryAdapter {
  override readHistory(): Promise<AgentHistoryReadResult> {
    return Promise.reject(new Error('secret provider transcript path'));
  }
}

export function fakeHistoryFactory(state: FakeHistoryState): AdapterFactory {
  return (kind) => new FakeHistoryAdapter(kind, state);
}
