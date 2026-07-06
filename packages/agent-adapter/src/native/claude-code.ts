import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKPermissionDeniedMessage,
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
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  StartOptions,
  StopReason,
  ToolCall,
  ToolCallContent,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant, nullthrow } from 'foxts/guard';
import { BaseAgentAdapter } from '../base';
import {
  asHistoryId,
  asMessageId,
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
import { contentToText, locationsFromToolInput, toolKindFromName } from '../util';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantSDKMessage = Extract<SDKMessage, { type: 'assistant' }>;
type AssistantMessage = AssistantSDKMessage['message'];
type UserSDKMessage = Extract<SDKMessage, { type: 'user' }>;
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

/** Claude's subagent-spawning tool: named `Agent` in current CLIs (verified live against the
 * vendored 0.3.x), `Task` in older transcripts — history replay still meets the old name. Exact
 * match on purpose: the shared name-based classifier stays untouched so other adapters (e.g.
 * opencode's lowercase `task`) opt in deliberately rather than by regex accident. */
function claudeToolKind(name: string): ToolCall['kind'] {
  return name === 'Task' || name === 'Agent' ? 'task' : toolKindFromName(name);
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/**
 * The approval-policy axis claude-code advertises; ids map 1:1 onto the SDK's `PermissionMode` and
 * names/order match Claude Desktop's own Mode menu. Claude models permission handling and plan as
 * ONE axis, so `plan` rides this channel for claude-code (the generic `set-mode` workflow axis
 * remains for agents like codex where plan is a workflow mode); the composer dedupes the stub
 * workflow entry by id. Only `dontAsk` stays off the menu: its deny-by-default adds nothing over
 * rejecting the asks `default` already raises.
 */
const APPROVAL_POLICIES = [
  {
    policyId: 'default',
    name: 'Ask permissions',
    description: 'Always ask before editing files and running commands.',
  },
  {
    policyId: 'acceptEdits',
    name: 'Accept edits',
    description: 'Auto-approve file edits; still ask for everything else.',
  },
  {
    policyId: 'plan',
    name: 'Plan mode',
    description: 'Read-only research; propose a plan before making changes.',
  },
  {
    policyId: 'auto',
    name: 'Auto mode',
    description: 'A classifier approves routine actions and blocks risky or external ones.',
  },
  {
    policyId: 'bypassPermissions',
    name: 'Bypass permissions',
    description: 'Skip all permission prompts in this workspace.',
  },
] as const satisfies ReadonlyArray<ApprovalPolicy & { policyId: PermissionMode }>;

type ClaudeApprovalPolicyId = (typeof APPROVAL_POLICIES)[number]['policyId'];

/**
 * Resolve `permissions.defaultMode` from Claude settings, same precedence as the CLI
 * (local > project > user). The SDK-driven CLI pins its startup mode to 'default' unless
 * `--permission-mode` is passed — unlike the interactive CLI it does NOT apply the settings
 * default itself (verified empirically against 0.3.179's vendored CLI, including with explicit
 * `settingSources`) — so honoring the user's configured default is on the adapter.
 */
async function settingsDefaultMode(cwd: string): Promise<ClaudeApprovalPolicyId | undefined> {
  const files = [
    path.join(cwd, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(homedir(), '.claude', 'settings.json'),
  ];
  for (const file of files) {
    let mode: unknown;
    try {
      // eslint-disable-next-line no-await-in-loop -- precedence order is inherently sequential
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      mode =
        isRecord(parsed) && isRecord(parsed.permissions)
          ? parsed.permissions.defaultMode
          : undefined;
    } catch {
      continue; // Missing or malformed settings scope — fall through to the next one.
    }
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === mode);
    if (policy) return policy.policyId;
  }
  return undefined;
}

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
  /** The approval policy the session runs under; applied at `Query` creation and on live switches.
   * `undefined` = the user hasn't picked one — the CLI then resolves its own default (including
   * `permissions.defaultMode` from the user's settings.json), reported back via the init message. */
  private approvalPolicy: ClaudeApprovalPolicyId | undefined;
  /** Provider session id sniffed off the last SDK message — the resume point when an effort
   * transition into/out of `max` forces a process restart (see `onSetEffort`). */
  private lastSessionRef: string | undefined;
  /** Diff content parsed off an Edit/Write announce, keyed by tool_use id. Re-attached at settle
   * because `emitTool`'s merge replaces `content` wholesale — the result text must not wipe the
   * diff. */
  private readonly pendingEditDiffs = new Map<string, ToolCallContent[]>();

  protected async onStart(opts: StartOptions): Promise<void> {
    // The persistent Query is created lazily on the first onPrompt; just verify the SDK is installed.
    await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    this.approvalPolicy ??= await settingsDefaultMode(opts.cwd);
    this.emitApprovalPolicy(this.approvalPolicyState());
  }

  private approvalPolicyState(): ApprovalPolicyState {
    return {
      availablePolicies: [...APPROVAL_POLICIES],
      currentPolicyId: this.approvalPolicy ?? 'default',
    };
  }

  /** Adopt the effective mode the CLI reports (init message) — the authority when the user hasn't
   * picked a policy, since the CLI resolves settings.json's `permissions.defaultMode` itself. */
  private syncApprovalPolicy(mode: PermissionMode): void {
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === mode);
    if (!policy || policy.policyId === this.approvalPolicy) return;
    this.approvalPolicy = policy.policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
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
    this.freshSegment();
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
        // Forward subagent text/thinking (tool_use/tool_result already flow by default) so the
        // client can render the nested transcript; all subagent frames carry parent_tool_use_id.
        forwardSubagentText: true,
        canUseTool: this.canUseTool,
        // Resolved in onStart from settings.json `permissions.defaultMode` (see settingsDefaultMode)
        // — the SDK-driven CLI does not apply that setting itself. `undefined` only when neither the
        // user nor settings picked one, in which case the CLI starts in its 'default' mode.
        permissionMode: this.approvalPolicy,
        // Gate flag only — the effective mode stays `permissionMode` above. It must be set at
        // startup for a later live switch to 'bypassPermissions' to be accepted at all.
        allowDangerouslySkipPermissions: true,
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

  /** Live switch rides the streaming-input control request `Query#setPermissionMode`; before the
   * first prompt the `Query` doesn't exist yet, so the pick is only stashed and applied at creation
   * via `options.permissionMode`. The new state reflects only after the CLI accepted the switch, so
   * a rejected one (e.g. auto mode unavailable for the account) leaves the previous policy shown. */
  protected override async onSetApprovalPolicy(policyId: string): Promise<void> {
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === policyId);
    if (!policy) throw new Error(`claude-code: unknown approval policy: ${policyId}`);
    if (this.q) await this.q.setPermissionMode(policy.policyId);
    this.approvalPolicy = policy.policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
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

  /** A cancelled/failed turn never delivers the matching tool_results; drop their stashed diffs. */
  protected override teardown(): void {
    this.pendingEditDiffs.clear();
    super.teardown();
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const outcome = await this.requestPermission(
      {
        toolCallId: options.toolUseID,
        title: options.title ?? toolName,
        kind: claudeToolKind(toolName),
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
        this.handleStreamEvent(msg.event, msg.parent_tool_use_id);
        break;
      case 'assistant':
        this.handleAssistant(msg);
        break;
      case 'user':
        this.handleUser(msg);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      case 'system':
        // task_started/task_updated/task_progress intentionally fall through: a card's state derives
        // entirely from the Task tool_use/tool_result pair; consuming them (task_id ↔ tool_use_id
        // correlation) only pays off once run_in_background tasks are supported.
        if (msg.subtype === 'permission_denied') this.handlePermissionDenied(msg);
        else if (msg.subtype === 'init') this.syncApprovalPolicy(msg.permissionMode);
        break;
      default:
        break;
    }
  }

  /** A tool call auto-denied without an interactive ask (auto-mode classifier, deny rule, …) never
   * reaches `canUseTool`; this SDK event is the only carrier of the decider's reason. Settle the
   * announced tool as failed with that reason — the later `is_error` tool_result for the same id
   * says only "denied" and is ignored by `emitTool`'s terminal-state guard anyway. */
  private handlePermissionDenied(msg: SDKPermissionDeniedMessage): void {
    const diff = this.pendingEditDiffs.get(msg.tool_use_id) ?? [];
    this.pendingEditDiffs.delete(msg.tool_use_id);
    const reason = msg.decision_reason ?? msg.message;
    this.emitTool({
      toolCallId: msg.tool_use_id,
      title: msg.tool_name,
      kind: claudeToolKind(msg.tool_name),
      status: 'failed',
      content: [
        ...diff,
        ...(reason ? [{ type: 'content' as const, content: textBlock(reason) }] : []),
      ],
    });
  }

  private handleStreamEvent(event: StreamEvent, parentToolUseId: string | null): void {
    // Subagent narration renders message-level from the forwarded assistant frames
    // (handleSubagentAssistant); consuming its deltas here would render the same text twice.
    if (parentToolUseId) return;
    if (event.type !== 'content_block_delta') return;
    const delta = event.delta;
    if (delta.type === 'text_delta') this.emitAssistantText(delta.text, this.messageId);
    else if (delta.type === 'thinking_delta') this.emitThought(delta.thinking, this.thoughtId);
  }

  private handleAssistant(msg: AssistantSDKMessage): void {
    if (msg.parent_tool_use_id) {
      this.handleSubagentAssistant(msg.message, msg.parent_tool_use_id, msg.uuid);
      return;
    }
    const message = msg.message;
    let calledTool = false;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        const diff = editDiffContent(block.name, block.input);
        if (diff) this.pendingEditDiffs.set(block.id, diff);
        // Announce the tool the moment Claude requests it; the matching tool_result settles it.
        this.emitTool({
          toolCallId: block.id,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content: diff,
          rawInput: block.input,
          locations: locationsFromToolInput(block.input),
        });
        calledTool = true;
      }
    }
    // A tool call closes this assistant segment; text Claude streams after the tool_result groups into a
    // fresh bubble rather than merging with the pre-tool narration.
    if (calledTool) this.freshSegment();
  }

  /**
   * A subagent's assistant frame (`parent_tool_use_id` set): its tool calls carry the spawning Task's
   * id, and its text/thinking — forwarded whole via `forwardSubagentText` — render message-level under
   * the frame's own uuid. It never touches the main `messageId`/`thoughtId` cursors and never calls
   * `freshSegment()`, so a subagent running mid-turn cannot break the main agent's streaming bubble.
   * (The uuid doubles as the history mapper's id, so a live turn and a later cold-resume seed converge.)
   */
  private handleSubagentAssistant(message: AssistantMessage, parent: string, uuid: string): void {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        const diff = editDiffContent(block.name, block.input);
        if (diff) this.pendingEditDiffs.set(block.id, diff);
        this.emitTool({
          toolCallId: block.id,
          parentToolCallId: parent,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content: diff,
          rawInput: block.input,
          locations: locationsFromToolInput(block.input),
        });
      } else if (block.type === 'text') {
        this.emitAssistantText(block.text, asMessageId(uuid), parent);
      } else if (block.type === 'thinking') {
        this.emitThought(block.thinking, asMessageId(`${uuid}:think`), parent);
      }
    }
  }

  /**
   * Tool results come back on the *user* message (Claude's API pairs every `tool_use` with a
   * `tool_result`). This is also where a denied permission lands: the SDK synthesizes an `is_error`
   * result with "Denied by the user", so the same branch settles success, failure, and deny alike.
   */
  private handleUser(msg: UserSDKMessage): void {
    const content = msg.message.content;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const diff = this.pendingEditDiffs.get(block.tool_use_id) ?? [];
      this.pendingEditDiffs.delete(block.tool_use_id);
      this.emitTool({
        toolCallId: block.tool_use_id,
        // Re-stated on settle so the parent link survives even if the announce was never seen
        // (e.g. it sat beyond a history read's page window). Null for main-agent results.
        parentToolCallId: msg.parent_tool_use_id ?? undefined,
        status: block.is_error === true ? 'failed' : 'completed',
        content: [...diff, ...toolResultContent(block.content)],
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

/**
 * Claude's file-mutation tools carry the exact patch in their input — Edit as `file_path` /
 * `old_string` / `new_string`, Write as `file_path` / `content` (a whole-file write, so no
 * oldText: the UI renders it as all-added lines). Surface it as structured diff content so the
 * UI renders a diff instead of the raw input JSON. Returns undefined for every other tool
 * (including NotebookEdit, whose input has no old cell source to diff against) and for a
 * malformed input.
 */
function editDiffContent(toolName: string, input: unknown): ToolCallContent[] | undefined {
  if (!isRecord(input)) return undefined;
  if (toolName === 'Edit') {
    const { file_path: path, old_string: oldText, new_string: newText } = input;
    if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
      return undefined;
    }
    return [{ type: 'diff', path, oldText, newText }];
  }
  if (toolName === 'Write') {
    const { file_path: path, content: newText } = input;
    if (typeof path !== 'string' || typeof newText !== 'string') return undefined;
    return [{ type: 'diff', path, newText }];
  }
  return undefined;
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
    // Subagent transcript rows carry the spawning Task's tool_use id, same as live frames.
    const parent = message.parent_tool_use_id ?? undefined;

    if (message.type === 'assistant') {
      const text = textHistoryEvent(
        historyId,
        'assistant',
        message.uuid,
        message.message,
        undefined,
        parent,
      );
      if (text) events.push(text);
      for (const block of blocks) {
        if (!isToolUseBlock(block)) continue;
        events.push(
          toolEvent({
            toolCallId: block.id,
            parentToolCallId: parent,
            title: block.name,
            kind: claudeToolKind(block.name),
            status: 'in_progress',
            content: editDiffContent(block.name, block.input) ?? [],
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
          parentToolCallId: parent ?? existing?.parentToolCallId,
          // The announce can sit beyond this read's page window; fall back to emitTool's
          // first-sight defaults rather than dropping the settle.
          title: existing?.title ?? block.tool_use_id,
          kind: existing?.kind ?? 'other',
          status: block.is_error === true ? 'failed' : 'completed',
          // Announce-time content is the Edit diff (or empty); keep it ahead of the result text.
          content: [...(existing?.content ?? []), ...toolResultContent(block.content)],
          rawInput: existing?.rawInput,
          rawOutput: block.content,
        }),
      );
    }
    // A subagent's user rows are only tool_results plus its injected prompt — never something the
    // user typed; emitting that prompt would fake a user turn inside the nested transcript.
    if (parent) return events;
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
