import type {
  CanUseTool,
  PermissionResult,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
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
  ToolCallContent,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nextMessageId } from '../adapter';
import { BaseAgentAdapter } from '../base';
import {
  asHistoryId,
  boundedLimit,
  compactRecord,
  cursorFromFetched,
  cursorOffset,
  firstText,
  isRecord,
  numberField,
  textHistoryEvent,
  timestampMs,
} from '../history-util';
import { contentToText, toolKindFromName } from '../util';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>['message'];
type UserMessage = Extract<SDKMessage, { type: 'user' }>['message'];
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;
type ToolResultParam = Extract<
  Exclude<UserMessage['content'], string>[number],
  { type: 'tool_result' }
>;

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/**
 * The `prompt` fed to a streaming-input `query()`: an `AsyncIterable<SDKUserMessage>` that stays open
 * for the whole session so `onPrompt` can push each new turn into an already-running `Query` instead of
 * spawning a fresh one. Only ever has one consumer (the SDK's own internal read loop).
 */
class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiting: ((message: SDKUserMessage | null) => void) | null = null;
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(message);
    } else {
      this.buffered.push(message);
    }
  }

  /** Ends the iterable, letting the SDK's read loop (and the underlying CLI's stdin) close cleanly. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiting?.(null);
    this.waiting = null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (this.buffered.length > 0) {
        yield this.buffered.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<SDKUserMessage | null>((resolve) => {
        this.waiting = resolve;
      });
      if (next === null) return;
      yield next;
    }
  }
}

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
 * Claude Code adapter — drives `@anthropic-ai/claude-agent-sdk` via `query()` in **streaming input
 * mode**: one persistent `Query` for the whole session, fed through `AsyncMessageQueue` so each new
 * prompt is pushed into the already-running session instead of spawning a fresh `query()` call.
 *
 * This replaced a single-message-per-turn + `resume` design. That was simpler, but the CLI silently
 * ignores a changed `model` option once a session is resumed — verified against the live SDK — so
 * live model switching was impossible. Streaming mode is the only way the SDK exposes mid-session
 * control (`Query#setModel`, `#setPermissionMode`, `#interrupt`); see `onSetModel` / `onCancel` below.
 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private q: Query | null = null;
  private inputQueue: AsyncMessageQueue | null = null;
  /** Session id to resume *once*, at the first `onPrompt`, when this adapter was started from saved
   * history — not updated afterwards; the persistent `Query` carries the conversation itself now. */
  private resumeFrom: string | undefined;
  /** Suppresses `emitError` for the interrupt-induced stream failure `onCancel` triggers on purpose. */
  private cancelling = false;
  /** Current segment's ids, refreshed each turn and after every tool call so text / thinking emitted
   * before and after a tool render as separate bubbles instead of merging into one. */
  private messageId: MessageId = nextMessageId();
  private thoughtId: MessageId = nextMessageId();

  protected async onStart(): Promise<void> {
    // The persistent Query is created lazily on the first onPrompt; just verify the SDK is installed.
    await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
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
      events: messages.slice(0, limit).reduce<AgentHistoryEvent[]>((events, message) => {
        const event = mapClaudeHistoryEvent(historyId, message);
        if (event) events.push(event);
        return events;
      }, []),
      cursor: cursorFromFetched(offset, messages.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    const opts = this.opts;
    if (!opts) throw new Error('claude-code: session not started');
    this.messageId = nextMessageId();
    this.thoughtId = nextMessageId();
    this.emitStatus('running');
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: contentToText(content) },
      parent_tool_use_id: null,
    };
    if (this.inputQueue) {
      // Session already running: hand the SDK's own queued-message support the next turn.
      this.inputQueue.push(message);
      return;
    }
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const queue = new AsyncMessageQueue();
    queue.push(message);
    this.inputQueue = queue;
    // One-time use: the persistent Query carries the conversation itself from here on, so a later
    // Query created after a crash must not resume from this same (by then stale) point again.
    const resume = this.resumeFrom;
    this.resumeFrom = undefined;
    this.q = query({
      prompt: queue,
      options: {
        cwd: opts.cwd,
        model: opts.model,
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        resume,
        additionalDirectories: opts.additionalDirectories,
      },
    });
    void this.consume(this.q);
  }

  /** Runs for the whole session — not per turn — dispatching every message the persistent `Query`
   * emits across every prompt pushed into `inputQueue`. Only returns when the underlying process
   * exits (crash, `close()`, or the CLI quitting on its own). */
  private async consume(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handleMessage(msg);
    } catch (err) {
      if (this.cancelling) this.cancelling = false;
      else this.emitError(extractErrorMessage(err) ?? 'Unknown error');
    }
    // Guard against clobbering a newer Query: if onPrompt already replaced this.q while this call
    // was unwinding, only this call's own q/inputQueue should be torn down here.
    if (this.q === q) {
      this.q = null;
      this.inputQueue = null;
    }
    // The process is gone; finalize anything a mid-flight turn left dangling.
    this.teardown();
    this.emitStatus('idle');
  }

  protected override async onCancel(): Promise<void> {
    this.cancelling = true;
    try {
      await this.q?.interrupt();
    } catch {
      // Nothing was in flight, so no result/error will follow to consume the flag — clear it now,
      // or a later unrelated error would be wrongly swallowed as if it were this cancel's fallout.
      this.cancelling = false;
    }
    // interrupt() stops the current turn's generation but doesn't guarantee a matching `result`
    // message, so finalize here too; teardown()/emitStatus('idle') are idempotent if one does follow.
    this.teardown();
    this.emitStatus('idle');
  }

  protected override onStop(): Promise<void> {
    this.q?.close();
    this.inputQueue?.close();
    return Promise.resolve();
  }

  /** Real live model switch via the persistent `Query`'s `setModel()` (streaming-input-mode-only
   * control request) — the single-message + `resume` design this replaced could not do this: the CLI
   * ignores a changed `model` option once a session is resumed. Before the first prompt, the `Query`
   * doesn't exist yet; fall back to updating `opts.model`, which `onPrompt` reads when it creates it. */
  protected override async onSetModel(model: string): Promise<void> {
    if (!this.q) {
      if (!this.opts) throw new Error('claude-code: session not started');
      this.opts.model = model;
      return;
    }
    await this.q.setModel(model);
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

  protected handleMessage(msg: SDKMessage): void {
    // A history-resumed session (see resumeFrom) replays prior turns as `isReplay` frames (historical
    // text + tool_results) right after the Query is created. Skip them: re-emitting as live events
    // would flood the stream and pollute the tool-call snapshot map.
    if ('isReplay' in msg) return;
    switch (msg.type) {
      case 'stream_event':
        this.handleStreamEvent(msg.event);
        break;
      case 'assistant':
        this.handleAssistant(msg.message);
        break;
      case 'user':
        this.handleUser(msg.message);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      default:
        break;
    }
  }

  private handleStreamEvent(event: StreamEvent): void {
    if (event.type !== 'content_block_delta') return;
    const delta = event.delta;
    if (delta.type === 'text_delta') this.emitAssistantText(delta.text, this.messageId);
    else if (delta.type === 'thinking_delta') this.emitThought(delta.thinking, this.thoughtId);
  }

  private handleAssistant(message: AssistantMessage): void {
    let calledTool = false;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        // Announce the tool the moment Claude requests it; the matching tool_result settles it.
        this.emitTool({
          toolCallId: block.id,
          title: block.name,
          kind: toolKindFromName(block.name),
          status: 'in_progress',
          rawInput: block.input,
        });
        calledTool = true;
      }
    }
    // A tool call closes this assistant segment; text Claude streams after the tool_result groups into a
    // fresh bubble rather than merging with the pre-tool narration.
    if (calledTool) {
      this.messageId = nextMessageId();
      this.thoughtId = nextMessageId();
    }
  }

  /**
   * Tool results come back on the *user* message (Claude's API pairs every `tool_use` with a
   * `tool_result`). This is also where a denied permission lands: the SDK synthesizes an `is_error`
   * result with "Denied by the user", so the same branch settles success, failure, and deny alike.
   */
  private handleUser(message: UserMessage): void {
    const content = message.content;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      this.emitTool({
        toolCallId: block.tool_use_id,
        status: block.is_error === true ? 'failed' : 'completed',
        content: toolResultContent(block.content),
        rawOutput: block.content,
      });
    }
  }

  /** A `result` message ends one turn — not the session, which now spans the whole `consume()` loop —
   * so this is where per-turn cleanup happens (unlike the old per-turn `query()` design, where the
   * loop ending *was* the turn ending). */
  private handleResult(msg: ResultMessage): void {
    if (msg.subtype === 'success') {
      const usage = isRecord(msg.usage) ? msg.usage : {};
      this.emitUsage({
        inputTokens: numberField(usage, 'input_tokens'),
        outputTokens: numberField(usage, 'output_tokens'),
        cacheReadTokens: numberField(usage, 'cache_read_input_tokens'),
        cacheCreationTokens: numberField(usage, 'cache_creation_input_tokens'),
        totalCostUsd: msg.total_cost_usd,
      });
      this.emitStop(mapClaudeStop(msg.stop_reason));
    } else if (this.cancelling) {
      // This non-success result is the fallout of our own onCancel()'s interrupt(), not a real
      // failure — consume the flag instead of surfacing it as an error.
      this.cancelling = false;
    } else {
      this.emitError('Claude returned an error', undefined, true);
    }
    this.teardown();
    this.emitStatus('idle');
  }
}

/** Normalize a tool_result's payload (string or content blocks) into tool-call content. */
function toolResultContent(content: ToolResultParam['content']): ToolCallContent[] {
  if (content === undefined) return [];
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'content', content: textBlock(content) }] : [];
  }
  return content.reduce<ToolCallContent[]>((items, block) => {
    if (block.type === 'text' && block.text.length > 0) {
      items.push({ type: 'content', content: textBlock(block.text) });
    }
    return items;
  }, []);
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
