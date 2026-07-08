import { env } from 'node:process';
import type {
  AmpOptions,
  AssistantMessage,
  ErrorResultMessage,
  ResultMessage,
  StreamMessage,
  Usage,
  UserMessage,
} from '@ampcode/sdk';
import type {
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ContentBlock,
  EffortLevel,
  StartOptions,
  ToolCall,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { BaseAgentAdapter } from '../../base';
import {
  asHistoryId,
  asMessageId,
  boundedLimit,
  cursorFromTotal,
  cursorOffset,
} from '../../history-util';
import { contentToText, locationsFromToolInput, toolKindFromName } from '../../util';
import { listAmpHistory, readAmpHistory } from './history';

/**
 * Amp has no user-facing model axis: `mode` selects the model + system-prompt bundle (per
 * ampcode.com/models: smart → Opus-class, deep/rush → GPT-class, large → 1M-context). LinkCode's
 * `model` input carries the mode — an encoding choice, same spirit as opencode overloading
 * `model` as `providerID/modelID`.
 */
const AMP_MODES = ['smart', 'deep', 'rush', 'large'] as const;
type AmpMode = (typeof AMP_MODES)[number];
const AMP_MODE_SET = new Set<string>(AMP_MODES);

function isAmpMode(value: string): value is AmpMode {
  return AMP_MODE_SET.has(value);
}

/** The shared effort axis ∩ Amp's: Amp additionally accepts none/minimal (never offered — they
 * would need an `EffortLevelSchema` extension) and lacks claude-only `ultracode`. Amp applies
 * effort only under the smart/deep modes and ignores it for rush/large — its own semantics,
 * not enforced here. */
const AMP_EFFORTS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max']);
type AmpEffort = Exclude<EffortLevel, 'ultracode'>;

/** Amp's subagent-spawning tool is `Task`; exact match (not the shared regex classifier) for the
 * same reason claude-code matches its `Agent`/`Task` exactly — see `claudeToolKind`. */
function ampToolKind(name: string): ToolCall['kind'] {
  return name === 'Task' ? 'task' : toolKindFromName(name);
}

/** `thinking: true` (`--stream-json-thinking`) adds thinking blocks the shipped SDK types do not
 * declare — `AssistantMessage`'s content union is text|tool_use only (SDK/CLI schema drift,
 * verified against @ampcode/sdk 0.1.0-20260605144103). Widened here; parsed defensively. */
type AmpAssistantBlock =
  | AssistantMessage['message']['content'][number]
  | { type: 'thinking'; thinking: string }
  | { type: 'redacted_thinking'; data: string };

/**
 * Amp adapter — drives the official `@ampcode/sdk`, whose `execute()` spawns
 * `amp --execute --stream-json` and streams whole NDJSON messages (message-level only: the wire
 * protocol has no token deltas and no in-flight tool updates, so Amp renders chunkier than the
 * other agents by design). One CLI process per turn: each prompt is its own `execute()` call
 * continuing the server-persisted thread (`continue: threadId`), which is what makes cancel
 * (abort kills only the current turn) and per-turn mode/effort switching possible — the flags are
 * spawn-time CLI arguments, so a persistent-process design could not switch them at all.
 *
 * Permissions are deliberately absent from the data plane: in execute mode the CLI constructs its
 * permissions plugin with `rejectPermissionPrompts: true`, so an `ask` rule auto-resolves to
 * reject-and-continue and no permission message type exists in the stream — there is nothing to
 * round-trip (verified against the CLI bundle; the `delegate` rule action is the only possible
 * bridge and is a follow-up). Amp's default posture without configured rules is to run tools
 * without prompting; the user's own settings (`~/.config/amp/settings.json`) still apply.
 *
 * Note: execute mode and the SDK consume paid Amp credits only — Amp Free does not cover
 * non-interactive use.
 */
export class AmpAdapter extends BaseAgentAdapter {
  readonly kind = 'amp' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  /** Thread id captured off the live stream. Every `StreamMessage.session_id` is the `T-…`
   * thread id (verified live: it round-trips into `threads continue`/`threads markdown`), but the
   * SDK types leave both as plain strings with no contractual link — so it is consumed
   * defensively rather than assumed. */
  private threadId: string | null = null;
  /** Thread to continue at the next turn when starting from saved history; kept armed until a
   * live message confirms the thread, so a failed spawn/turn does not silently downgrade the next
   * attempt into a brand-new thread. */
  private resumeFrom: string | undefined;
  /** Abort for the in-flight turn's CLI process; doubles as the "a turn is running" flag. */
  private abortTurn: AbortController | null = null;
  /** Suppresses the abort error that onCancel/onStop trigger on purpose. */
  private cancelling = false;
  /** Prompts received while a turn is running; drained one per turn end (mirrors codex). */
  private pendingPrompts: ContentBlock[][] = [];
  /** Mode/effort for the next turn's spawn; each turn being its own process makes next-turn
   * granularity the natural (and only possible) switching channel. */
  private mode: AmpMode | undefined;
  private effort: AmpEffort | undefined;
  /** Session-cumulative usage: Amp reports per-API-call usage on each assistant message and
   * consumers replace usage wholesale, so emit running totals (same reasoning as codex). */
  private readonly usageTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  protected async onStart(opts: StartOptions): Promise<void> {
    if (opts.model !== undefined) await this.onSetModel(opts.model);
    // The per-turn process spawns lazily at the first prompt; just verify the SDK is installed.
    await this.loadSdk('@ampcode/sdk', () => import('@ampcode/sdk'));
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }

  override listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    return listAmpHistory({
      offset: cursorOffset(opts?.cursor),
      limit: boundedLimit(opts?.limit, 50, 200),
      cwd: opts?.cwd,
    });
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const { session, events } = await readAmpHistory(opts.historyId);
    return {
      session,
      events: events.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, events.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (this.abortTurn) {
      this.pendingPrompts.push(content);
      return;
    }
    await this.runTurn(content);
  }

  protected override onCancel(): Promise<void> {
    // Cancel means stop: queued prompts are dropped (running them after an explicit cancel would
    // surprise), and the in-flight turn's process is killed. The thread itself is server-side and
    // survives; the next prompt continues it.
    this.pendingPrompts = [];
    if (this.abortTurn) {
      this.cancelling = true;
      this.abortTurn.abort();
    }
    return Promise.resolve();
  }

  protected override onStop(): Promise<void> {
    this.pendingPrompts = [];
    if (this.abortTurn) {
      this.cancelling = true;
      this.abortTurn.abort();
    }
    return Promise.resolve();
  }

  /** Mode is the model axis (see AMP_MODES); stored and applied at the next turn's spawn. */
  protected override onSetModel(model: string): Promise<void> {
    if (!isAmpMode(model)) {
      return Promise.reject(
        new Error(
          `amp: unknown mode '${model}' (amp's models are its modes: ${AMP_MODES.join(', ')})`,
        ),
      );
    }
    if (this.opts) this.opts.model = model;
    this.mode = model;
    return Promise.resolve();
  }

  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    if (!AMP_EFFORTS.has(effort)) {
      return Promise.reject(
        new Error(`amp: effort '${effort}' is not supported (amp accepts low through max)`),
      );
    }
    this.effort = effort as AmpEffort;
    return Promise.resolve();
  }

  private async runTurn(content: ContentBlock[]): Promise<void> {
    const opts = nullthrow(this.opts, 'amp: session not started');
    const sdk = await this.loadSdk('@ampcode/sdk', () => import('@ampcode/sdk'));
    const abort = new AbortController();
    this.abortTurn = abort;
    this.emitStatus('running');
    try {
      const stream = sdk.execute({
        prompt: contentToText(content),
        signal: abort.signal,
        options: this.executeOptions(opts),
      });
      for await (const message of stream) this.handleMessage(message);
    } catch (err) {
      // The stream rejects on abort (the SDK SIGTERMs the process and rethrows) and on non-zero
      // exit (auth failure, missing credits, bad thread id — stderr rides the message).
      if (this.cancelling) this.emitStop('cancelled');
      else this.emitError(extractErrorMessage(err) ?? 'amp: turn failed');
    } finally {
      this.cancelling = false;
      this.abortTurn = null;
      // The turn's process is gone; nothing will settle what it left dangling.
      this.teardown();
      const next = this.pendingPrompts.shift();
      if (next) void this.runTurn(next);
      else this.emitStatus('idle');
    }
  }

  private executeOptions(opts: StartOptions): AmpOptions {
    const apiKey = typeof opts.config?.apiKey === 'string' ? opts.config.apiKey : undefined;
    const continueThread = this.threadId ?? this.resumeFrom;
    return {
      cwd: opts.cwd,
      ...(this.mode && { mode: this.mode }),
      ...(this.effort && { effort: this.effort }),
      // Execute-created threads are archived when the run ends unless opted out; a session's
      // thread must stay live so later turns, resume, and history keep finding it.
      noArchiveAfterExecute: true,
      thinking: true,
      ...(continueThread !== undefined && { continue: continueThread }),
      // The SDK passes `env` to spawn verbatim — it REPLACES the child environment (same trap as
      // claude-code), so spread the parent env or PATH/HOME vanish. process.env carries no
      // undefined values at runtime; the cast bridges its looser TS type.
      ...(apiKey && { env: { ...env, AMP_API_KEY: apiKey } }),
    };
  }

  private handleMessage(message: StreamMessage): void {
    this.handleThreadRef(message);
    switch (message.type) {
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'user':
        this.handleUser(message);
        break;
      case 'result':
        this.handleResult(message);
        break;
      default:
        // system/init (tool + MCP inventory) has nothing to surface yet.
        break;
    }
  }

  /** Track the live thread and announce the session-ref. A fresh thread's ref is held until the
   * turn's result: Amp threads are server-side and `threads export` sees only persisted turns, so
   * announcing at init would let a client's transcript-seed read race the server persisting the
   * first prompt (the same race codex defers for). A resumed thread is already complete —
   * announce on the first live message instead, which doubles as the resume confirmation. */
  private handleThreadRef(message: StreamMessage): void {
    const id = message.session_id;
    if (typeof id !== 'string' || id.length === 0) return;
    const resumed = this.resumeFrom !== undefined;
    this.threadId = id;
    if (resumed) this.resumeFrom = undefined;
    if (resumed || message.type === 'result') this.emitSessionRef(asHistoryId(id));
  }

  private handleAssistant(msg: AssistantMessage): void {
    // Subagent frames carry the spawning Task's tool_use id; their text renders message-level
    // under the frame's own message id and their tools nest via parentToolCallId.
    const parent = msg.parent_tool_use_id ?? undefined;
    const messageId = asMessageId(msg.message.id);
    for (const block of msg.message.content as readonly AmpAssistantBlock[]) {
      // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (redacted_thinking is ignored); the switch autofix then trips the error-level default-case rule
      if (block.type === 'text') {
        // Message-level grouping under the provider's message id: one assistant message, one
        // bubble. There is no delta stream to accumulate, so the base segment cursors are unused.
        this.emitAssistantText(block.text, messageId, parent);
      } else if (block.type === 'thinking') {
        this.emitThought(block.thinking, asMessageId(`${msg.message.id}:think`), parent);
      } else if (block.type === 'tool_use') {
        // Announce when Amp requests the tool; the matching tool_result settles it.
        this.emitTool({
          toolCallId: block.id,
          parentToolCallId: parent,
          title: block.name,
          kind: ampToolKind(block.name),
          status: 'in_progress',
          rawInput: block.input,
          locations: locationsFromToolInput(block.input),
        });
      }
    }
    if (msg.message.usage) this.accumulateUsage(msg.message.usage);
  }

  /** Tool results ride user messages (Anthropic-shaped pairing). The submitted prompt also echoes
   * back as a user text message — dropped: the engine already broadcast it when it accepted the
   * prompt, and replaying it would duplicate the bubble. */
  private handleUser(msg: UserMessage): void {
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      this.emitTool({
        toolCallId: block.tool_use_id,
        parentToolCallId: msg.parent_tool_use_id ?? undefined,
        status: block.is_error ? 'failed' : 'completed',
        content:
          block.content.length > 0 ? [{ type: 'content', content: textBlock(block.content) }] : [],
        rawOutput: block.content,
      });
    }
  }

  private handleResult(msg: ResultMessage | ErrorResultMessage): void {
    // msg.usage is skipped: its aggregation window is undocumented, and the per-call usage on
    // assistant messages already accumulated this turn — adding it would risk double counting.
    if (msg.is_error) {
      if (msg.subtype === 'error_max_turns') this.emitStop('max_turn_requests');
      else this.emitError(msg.error);
    } else {
      this.emitStop('end_turn');
    }
  }

  private accumulateUsage(usage: Usage): void {
    this.usageTotals.input += usage.input_tokens;
    this.usageTotals.output += usage.output_tokens;
    this.usageTotals.cacheRead += usage.cache_read_input_tokens ?? 0;
    this.usageTotals.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    this.emitUsage({
      inputTokens: this.usageTotals.input,
      outputTokens: this.usageTotals.output,
      cacheReadTokens: this.usageTotals.cacheRead,
      cacheCreationTokens: this.usageTotals.cacheCreation,
    });
  }
}
