import type {
  CanUseTool,
  PermissionResult,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentHistorySession,
  ContentBlock,
  MessageId,
  PermissionOption,
  StartOptions,
  StopReason,
} from '@linkcode/schema';
import { nextMessageId } from '../adapter';
import { BaseAgentAdapter } from '../base';
import {
  asHistoryId,
  boundedLimit,
  compactRecord,
  cursorFromFetched,
  cursorOffset,
  firstText,
  textHistoryEvent,
  timestampMs,
} from '../history-util';
import { contentToText, toolKindFromName } from '../util';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>['message'];
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/** Map Claude's stop reason to our ACP-aligned StopReason. */
export function mapClaudeStop(reason: string | null): StopReason {
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      // Claude's 'end_turn' / 'tool_use' / 'stop_sequence' all map to a normal end of turn.
      return 'end_turn';
  }
}

/**
 * Claude Code adapter — drives `@anthropic-ai/claude-agent-sdk` via `query()`.
 * Each prompt is a string turn; conversation continuity is preserved with `resume` (the previous
 * session id). Streaming deltas arrive via `includePartialMessages`; permission asks go through
 * `canUseTool`, bridged onto our permission-request/response round-trip.
 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private q: Query | null = null;
  private abort: AbortController | null = null;
  private sessionId: string | undefined;

  protected async onStart(): Promise<void> {
    // query() starts per-prompt; just verify the SDK is installed up front.
    await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.sessionId = opts.historyId;
    await this.start(startOpts);
  }

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    const mod = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    const offset = cursorOffset(opts?.cursor);
    const limit = boundedLimit(opts?.limit, 50, 200);
    const sessions = await mod.listSessions({
      dir: opts?.cwd,
      limit: limit + 1,
      offset,
    });
    return {
      sessions: sessions.slice(0, limit).map(mapClaudeHistorySession),
      cursor: cursorFromFetched(offset, sessions.length, limit),
    };
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const mod = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const [info, messages] = await Promise.all([
      mod.getSessionInfo(opts.historyId),
      mod.getSessionMessages(opts.historyId, {
        limit: limit + 1,
        offset,
      }),
    ]);
    const historyId = opts.historyId;
    return {
      session: info
        ? mapClaudeHistorySession(info)
        : { historyId, kind: this.kind, title: historyId },
      events: messages
        .slice(0, limit)
        .map((message) => mapClaudeHistoryEvent(historyId, message))
        .filter((event): event is AgentHistoryEvent => event !== undefined),
      cursor: cursorFromFetched(offset, messages.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    const opts = this.opts;
    if (!opts) throw new Error('claude-code: session not started');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const abort = new AbortController();
    this.abort = abort;
    const messageId = nextMessageId();
    const thoughtId = nextMessageId();
    this.emitStatus('running');
    const q = query({
      prompt: contentToText(content),
      options: {
        cwd: opts.cwd,
        model: opts.model,
        abortController: abort,
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        resume: this.sessionId,
        additionalDirectories: opts.additionalDirectories,
      },
    });
    this.q = q;
    try {
      for await (const msg of q) this.handleMessage(msg, messageId, thoughtId);
    } catch (err) {
      if (!abort.signal.aborted) {
        this.emitError(err instanceof Error ? err.message : String(err));
      }
    }
    this.q = null;
    this.emitStatus('idle');
  }

  protected override async onCancel(): Promise<void> {
    try {
      await this.q?.interrupt();
    } catch {
      // interrupt may reject if the turn already finished; fall through to abort.
    }
    this.abort?.abort();
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const outcome = await this.requestPermission(
      {
        toolCallId: options.toolUseID,
        title: options.title ?? toolName,
        kind: toolKindFromName(toolName),
        rawInput: input,
      },
      PERMISSION_OPTIONS,
    );
    const allowed =
      outcome.outcome === 'selected' &&
      (outcome.optionId === 'allow' || outcome.optionId === 'allow_always');
    if (allowed) return { behavior: 'allow', updatedInput: input } satisfies PermissionResult;
    return { behavior: 'deny', message: 'Denied by the user' } satisfies PermissionResult;
  };

  private handleMessage(msg: SDKMessage, messageId: MessageId, thoughtId: MessageId): void {
    if ('session_id' in msg && typeof msg.session_id === 'string') this.sessionId = msg.session_id;
    switch (msg.type) {
      case 'stream_event':
        this.handleStreamEvent(msg.event, messageId, thoughtId);
        break;
      case 'assistant':
        this.handleAssistant(msg.message);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      default:
        break;
    }
  }

  private handleStreamEvent(event: StreamEvent, messageId: MessageId, thoughtId: MessageId): void {
    if (event.type !== 'content_block_delta') return;
    const delta = event.delta;
    if (delta.type === 'text_delta') this.emitAssistantText(delta.text, messageId);
    else if (delta.type === 'thinking_delta') this.emitThought(delta.thinking, thoughtId);
  }

  private handleAssistant(message: AssistantMessage): void {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        this.emit({
          type: 'tool-call',
          toolCall: {
            toolCallId: block.id,
            title: block.name,
            kind: toolKindFromName(block.name),
            status: 'in_progress',
            content: [],
            rawInput: block.input,
          },
        });
      }
    }
  }

  private handleResult(msg: ResultMessage): void {
    if (msg.subtype === 'success') {
      const usage = msg.usage as unknown as Record<string, number>;
      this.emitUsage({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        totalCostUsd: msg.total_cost_usd,
      });
      this.emitStop(mapClaudeStop(msg.stop_reason));
    } else {
      this.emitError('Claude returned an error', undefined, true);
    }
  }
}

function mapClaudeHistorySession(session: SDKSessionInfo): AgentHistorySession {
  return {
    historyId: asHistoryId(session.sessionId),
    kind: 'claude-code',
    title: firstText(session.customTitle, session.summary, session.firstPrompt),
    cwd: session.cwd,
    createdAt: timestampMs(session.createdAt),
    updatedAt: timestampMs(session.lastModified),
    metadata: compactRecord({
      fileSize: session.fileSize,
      gitBranch: session.gitBranch,
      tag: session.tag,
    }),
  };
}

function mapClaudeHistoryEvent(
  historyId: AgentHistoryId,
  message: SessionMessage,
): AgentHistoryEvent | undefined {
  if (message.type !== 'user' && message.type !== 'assistant') return undefined;
  return textHistoryEvent(historyId, message.type, message.uuid, message.message);
}
