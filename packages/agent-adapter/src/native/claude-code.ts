import { env } from 'node:process';
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
  EffortLevel,
  MessageId,
  PermissionOption,
  StartOptions,
  StopReason,
  ToolCall,
  ToolCallContent,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant, nullthrow } from 'foxts/guard';
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

/**
 * Map a switchable effort onto Claude's flag-settings keys. `ultracode` is its own boolean key
 * (xhigh plus standing dynamic-workflow orchestration), not an `effortLevel` value; a plain level
 * clears it (`null` drops the key from the flag layer) so the session actually leaves ultracode
 * instead of staying pinned at xhigh by the still-set flag. `max` never comes through here — it
 * can't travel flag-settings at all (see `onSetEffort`).
 */
function effortFlagSettings(
  effort: Exclude<EffortLevel, 'max'>,
): Parameters<Query['applyFlagSettings']>[0] {
  if (effort === 'ultracode') return { ultracode: true };
  return { ultracode: null, effortLevel: effort };
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
  /** The effort the session should run at; applied at `Query` creation and on live switches. */
  private effort: EffortLevel | undefined;
  /** Provider session id sniffed off the last SDK message — the resume point when an effort
   * transition into/out of `max` forces a process restart (see `onSetEffort`). */
  private lastSessionRef: string | undefined;
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
      events: messages.slice(0, limit).flatMap(createClaudeHistoryEventMapper(historyId)),
      cursor: cursorFromFetched(offset, messages.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    const opts = nullthrow(this.opts, 'claude-code: session not started');
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
    this.inputQueue = queue;
    // One-time use: the persistent Query carries the conversation itself from here on, so a later
    // Query created after a crash must not resume from this same (by then stale) point again.
    const resume = this.resumeFrom;
    this.resumeFrom = undefined;
    // The SDK has no apiKey option; the key reaches the subprocess via `env`. Because `env` *replaces*
    // the subprocess environment entirely, spread `env` so PATH/HOME and other inherited vars survive.
    const apiKey = typeof opts.config?.apiKey === 'string' ? opts.config.apiKey : undefined;
    const q = query({
      prompt: queue,
      options: {
        cwd: opts.cwd,
        model: opts.model,
        // `options.effort` becomes the CLI's `--effort` flag, which outranks the flag-settings
        // layer for the process's whole lifetime — passing it would pin the level and turn every
        // later applyFlagSettings switch into a silent no-op. Only `max` goes in here (the
        // flag-settings key rejects it, so the startup flag is its only way in); the other levels
        // apply through the switchable channel right after creation.
        effort: this.effort === 'max' ? 'max' : undefined,
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        resume,
        additionalDirectories: opts.additionalDirectories,
        ...(apiKey && { env: { ...env, ANTHROPIC_API_KEY: apiKey } }),
      },
    });
    this.q = q;
    void this.consume(q);
    if (this.effort !== undefined && this.effort !== 'max') {
      try {
        await q.applyFlagSettings(effortFlagSettings(this.effort));
      } catch (err) {
        // A stored level the CLI rejects (ultracode without dynamic workflows enabled is the
        // known case) must not fail the prompt or wedge every later one on the same rejection:
        // drop it, report it on the session, and let the turn run at the CLI's default level.
        this.effort = undefined;
        this.emitError(extractErrorMessage(err) ?? 'claude-code: effort switch rejected');
      }
    }
    // Pushed only after the effort is applied, so the first turn cannot start at — or race the
    // control request from — the CLI's default level.
    queue.push(message);
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
      invariant(this.opts, 'claude-code: session not started');
      this.opts.model = model;
      return;
    }
    await this.q.setModel(model);
  }

  /** Effort switching has two channels. low–xhigh and `ultracode` switch live via the flag-settings
   * control request (`Query#applyFlagSettings`) — the same layer the CLI's `/effort` writes; see
   * `effortFlagSettings` for how each maps onto the `effortLevel` / `ultracode` keys. `max` can't
   * travel that channel (the key rejects it); its only way in is the `--effort` startup flag,
   * which in turn outranks flag-settings for the process's whole lifetime. So any transition into
   * or out of `max` closes the live process and lets the next prompt rebuild the `Query` — resuming
   * the conversation in place via the session id sniffed off the last SDK message. */
  protected override async onSetEffort(effort: EffortLevel): Promise<void> {
    const previous = this.effort;
    // Re-picking the current level is a no-op — it must not restart a live `max` process.
    if (effort === previous) return;
    if (!this.q) {
      this.effort = effort; // No process yet; onPrompt's Query creation applies it.
      return;
    }
    if (effort !== 'max' && previous !== 'max') {
      await this.q.applyFlagSettings(effortFlagSettings(effort));
      // Committed only after the CLI accepted the switch: a rejected one (ultracode without
      // dynamic workflows enabled) must not linger and get replayed onto a later rebuilt Query.
      this.effort = effort;
      return;
    }
    this.effort = effort;
    // Detach before closing so a prompt racing the async consume() unwind creates the new Query
    // instead of pushing into the closed queue; consume()'s self-guard then skips its own cleanup.
    const q = this.q;
    const queue = this.inputQueue;
    this.q = null;
    this.inputQueue = null;
    // If the process died before any message carried a session id there is nothing to resume;
    // the rebuilt Query then simply starts fresh, keeping the same Link Code session.
    this.resumeFrom = this.lastSessionRef;
    q.close();
    queue?.close();
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
    // Every SDK message carries the CLI's session id — the provider-local history id this live run
    // writes to. Sniffed before the replay guard so a resumed session binds immediately.
    if (typeof msg.session_id === 'string' && msg.session_id.length > 0) {
      this.lastSessionRef = msg.session_id;
      this.emitSessionRef(asHistoryId(msg.session_id));
    }
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

/** Normalize a tool_result's payload (string or content blocks) into tool-call content. Accepts
 * `unknown` because it also runs over untyped transcript rows, not only live SDK messages. */
function toolResultContent(content: unknown): ToolCallContent[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'content', content: textBlock(content) }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.reduce<ToolCallContent[]>((items, block) => {
    if (
      isRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.length > 0
    ) {
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

/**
 * Stateful per-read mapper: correlates each `tool_use` announce with the `tool_result` that later
 * settles it, replaying the same announce/settle full-snapshot pairs the live path emits — under
 * the provider's `toolu_` ids, so a seeded timeline and live re-emits of the same call converge
 * by id (`buildConversation` replaces tool calls by id) instead of duplicating.
 */
export function createClaudeHistoryEventMapper(
  historyId: AgentHistoryId,
): (message: SessionMessage) => AgentHistoryEvent[] {
  const announced = new Map<string, ToolCall>();

  const toolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
    announced.set(toolCall.toolCallId, toolCall);
    return { historyId, itemId: toolCall.toolCallId, event: { type: 'tool-call', toolCall } };
  };

  return (message) => {
    if (message.type !== 'user' && message.type !== 'assistant') return [];
    const events: AgentHistoryEvent[] = [];
    const blocks = messageContentBlocks(message.message);

    if (message.type === 'assistant') {
      const text = textHistoryEvent(historyId, 'assistant', message.uuid, message.message);
      if (text) events.push(text);
      for (const block of blocks) {
        if (!isToolUseBlock(block)) continue;
        events.push(
          toolEvent({
            toolCallId: block.id,
            title: block.name,
            kind: toolKindFromName(block.name),
            status: 'in_progress',
            content: [],
            rawInput: block.input,
          }),
        );
      }
      return events;
    }

    const results = blocks.filter((block) => isToolResultBlock(block));
    for (const block of results) {
      const existing = announced.get(block.tool_use_id);
      events.push(
        toolEvent({
          toolCallId: block.tool_use_id,
          // The announce can sit beyond this read's page window; fall back to emitTool's
          // first-sight defaults rather than dropping the settle.
          title: existing?.title ?? block.tool_use_id,
          kind: existing?.kind ?? 'other',
          status: block.is_error === true ? 'failed' : 'completed',
          content: toolResultContent(block.content),
          rawInput: existing?.rawInput,
          rawOutput: block.content,
        }),
      );
    }
    // Tool-result rows are synthetic user messages; only what remains after removing the
    // tool_results is a prompt the user actually typed.
    const promptValue =
      results.length === 0 ? message.message : blocks.filter((block) => !isToolResultBlock(block));
    const text = textHistoryEvent(historyId, 'user', message.uuid, promptValue);
    if (text) events.push(text);
    return events;
  };
}

interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: unknown;
  content?: unknown;
}

function messageContentBlocks(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  const content = message.content;
  return Array.isArray(content) ? content : [];
}

function isToolUseBlock(block: unknown): block is ClaudeToolUseBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    block.id.length > 0 &&
    typeof block.name === 'string' &&
    block.name.length > 0
  );
}

function isToolResultBlock(block: unknown): block is ClaudeToolResultBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_result' &&
    typeof block.tool_use_id === 'string' &&
    block.tool_use_id.length > 0
  );
}
