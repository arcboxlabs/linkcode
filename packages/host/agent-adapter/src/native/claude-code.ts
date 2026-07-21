import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';
import type {
  CanUseTool,
  HookCallback,
  PermissionMode,
  PermissionResult,
  Query,
  SDKCompactBoundaryMessage,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKPermissionDeniedMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources';
import { toHostPath } from '@linkcode/common/node';
import type {
  AgentCommand,
  AgentEvent,
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
  SupportedAttachmentImageMimeType,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  UsageRateLimitWindow,
  UsageReport,
} from '@linkcode/schema';
import {
  agentCommandMatches,
  EffortLevelSchema,
  isSupportedAttachmentImageMimeType,
  textBlock,
  UsageReportSchema,
} from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { z } from 'zod';
import { AUTH_FAILED_ERROR_CODE } from '../adapter';
import { BaseAgentAdapter } from '../base';
import { claudeCodeEnv, readAgentCredential } from '../credential';
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
  stringField,
  textHistoryEvent,
  thoughtHistoryEvent,
  timestampMs,
} from '../history-util';
import { agentRuntimeProber } from '../probe';
import { contentToText, imageBlocksFrom, locationsFromToolInput, toolKindFromName } from '../util';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantSDKMessage = Extract<SDKMessage, { type: 'assistant' }>;
type AssistantMessage = AssistantSDKMessage['message'];
type UserSDKMessage = Extract<SDKMessage, { type: 'user' }>;
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

/** Claude's subagent-spawning tool: `Agent` in current CLIs (verified live against the vendored
 * 0.3.x), `Task` in older transcripts still met by history replay. Exact match on purpose so other
 * adapters (e.g. opencode's lowercase `task`) opt in deliberately, not by regex accident. */
function claudeToolKind(name: string): ToolCall['kind'] {
  return name === 'Task' || name === 'Agent' ? 'task' : toolKindFromName(name);
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/** AskUserQuestion's tool input (the CLI caps questions at 4 and options at 2–4; only what the
 * client renders is required here, so benign vendor additions don't break the parse). */
const ASK_USER_QUESTION_INPUT = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().optional(),
        multiSelect: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
          .min(1),
      }),
    )
    .min(1),
});

/**
 * The approval-policy axis claude-code advertises: ids map 1:1 onto the SDK's `PermissionMode`,
 * names/order match Claude Desktop's Mode menu. Claude models permissions and plan as ONE axis, so
 * `plan` rides this channel rather than the generic `set-mode` workflow axis (the composer dedupes
 * the stub workflow entry by id). `dontAsk` stays off the menu — its deny-by-default adds nothing
 * over rejecting the asks `default` already raises.
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
 * Resolve `permissions.defaultMode` from Claude settings, same precedence as the CLI (local >
 * project > user). Unlike the interactive CLI, the SDK-driven CLI pins its startup mode to
 * 'default' and does NOT apply the settings default itself (verified against 0.3.179's vendored
 * CLI, even with explicit `settingSources`) — honoring it is on the adapter.
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
 * The `prompt` fed to a streaming-input `query()`: stays open for the whole session so `onPrompt`
 * pushes each turn into the running `Query`. Single consumer (the SDK's own internal read loop).
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
      // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-message signal
      const next = await new Promise<SDKUserMessage | null>((resolve) => {
        this.waiting = resolve;
      });
      if (next === null) return;
      yield next;
    }
  }
}

/**
 * Map a switchable effort onto Claude's flag-settings keys. `ultracode` is its own boolean key, not
 * an `effortLevel` value; a plain level must clear it (`null` drops the key) or the session stays
 * pinned at xhigh. `max` never comes through here — it can't travel flag-settings (see `onSetEffort`).
 */
function effortFlagSettings(
  effort: Exclude<EffortLevel, 'max' | 'ultra'>,
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

/** Preserve the SDK's structured failure diagnostics instead of collapsing every terminal result
 * into the same generic message. The machine-readable subtype/reason make provider failures
 * attributable even when the CLI supplies no prose in `errors`. */
function claudeResultErrorMessage(msg: Exclude<ResultMessage, { subtype: 'success' }>): string {
  const terminal = msg.terminal_reason ? `, ${msg.terminal_reason}` : '';
  const errors = msg.errors.filter((error) => error.length > 0).join('; ');
  return `Claude failed (${msg.subtype}${terminal})${errors ? `: ${errors}` : ''}`;
}

/** Normalize a `SlashCommand` onto `AgentCommand`: empty-string `description`/`argumentHint` and an
 * empty `aliases` list become `undefined`. Aliases ride through so composer/engine matching accepts
 * them; invocation pushes the alias itself, which the CLI resolves like any typed `/`. */
function mapClaudeCommand(command: SlashCommand): AgentCommand {
  return {
    name: command.name,
    description: command.description || undefined,
    argumentHint: command.argumentHint || undefined,
    aliases: command.aliases?.length ? command.aliases : undefined,
  };
}

/** Flatten the SDK's named rate-limit windows into the schema's self-describing `windows` table.
 * Claude carries each window's length in its field NAME, not its payload, so the mapper supplies
 * the explicit `durationMins` (5-hour = 300; the seven_day* fields and the per-model buckets are
 * weekly = 10080 per the SDK's own doc comments). A window the server reported as null
 * ("not available") or omitted is simply absent from the table. */
function usageWindows(
  limits: NonNullable<SDKControlGetUsageResponse['rate_limits']>,
): UsageRateLimitWindow[] {
  const windows: UsageRateLimitWindow[] = [];
  const push = (
    id: string,
    durationMins: number,
    window: { utilization: number | null; resets_at: string | null } | null | undefined,
  ): void => {
    if (!window) return;
    windows.push({ id, utilization: window.utilization, resetsAt: window.resets_at, durationMins });
  };
  push('five_hour', 300, limits.five_hour);
  push('seven_day', 10_080, limits.seven_day);
  push('seven_day_oauth_apps', 10_080, limits.seven_day_oauth_apps);
  push('seven_day_opus', 10_080, limits.seven_day_opus);
  push('seven_day_sonnet', 10_080, limits.seven_day_sonnet);
  for (const bucket of limits.model_scoped ?? []) {
    windows.push({
      label: bucket.display_name,
      utilization: bucket.utilization,
      resetsAt: bucket.resets_at,
      durationMins: 10_080,
    });
  }
  return windows;
}

type SdkBehaviorWindow = NonNullable<SDKControlGetUsageResponse['behaviors']>['day'];

function usageBehaviorWindow(
  window: SdkBehaviorWindow,
): NonNullable<NonNullable<UsageReport['behaviors']>['day']> {
  return {
    requestCount: window.request_count,
    sessionCount: window.session_count,
    behaviors: window.behaviors.map((b) => ({ key: b.key, pct: b.pct, count: b.count })),
    agents: window.agents,
    skills: window.skills,
    plugins: window.plugins,
    mcpServers: window.mcp_servers,
  };
}

/**
 * Map the SDK's experimental get-usage response onto the Link Code `UsageReport` contract, then
 * validate at this trust boundary: a drifted CLI reply fails the parse (surfacing as the command's
 * error) instead of shipping malformed data downstream. This mapper and `reportUsage` are the only
 * places the experimental SDK surface is allowed to appear. Verified against SDK 0.3.206.
 */
export function mapClaudeUsageReport(raw: SDKControlGetUsageResponse): UsageReport {
  const limits = raw.rate_limits;
  return UsageReportSchema.parse({
    session: {
      totalCostUsd: raw.session.total_cost_usd,
      totalApiDurationMs: raw.session.total_api_duration_ms,
      totalDurationMs: raw.session.total_duration_ms,
      totalLinesAdded: raw.session.total_lines_added,
      totalLinesRemoved: raw.session.total_lines_removed,
      modelUsage: Object.fromEntries(
        Object.entries(raw.session.model_usage).map(([model, usage]) => [
          model,
          {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadInputTokens,
            cacheCreationTokens: usage.cacheCreationInputTokens,
            totalCostUsd: usage.costUSD,
          },
        ]),
      ),
    },
    subscriptionType: raw.subscription_type,
    rateLimits: limits
      ? {
          windows: usageWindows(limits),
          extraUsage: limits.extra_usage
            ? {
                isEnabled: limits.extra_usage.is_enabled,
                monthlyLimit: limits.extra_usage.monthly_limit,
                usedCredits: limits.extra_usage.used_credits,
                utilization: limits.extra_usage.utilization,
                currency: limits.extra_usage.currency,
              }
            : limits.extra_usage,
        }
      : limits,
    behaviors: raw.behaviors
      ? {
          day: usageBehaviorWindow(raw.behaviors.day),
          week: usageBehaviorWindow(raw.behaviors.week),
        }
      : raw.behaviors,
  } satisfies UsageReport);
}

const EMPTY_SUPPLEMENT: ClaudeTranscriptSupplement = {
  records: new Map(),
  droppedRows: [],
  toolUseResults: new Map(),
};

/**
 * Claude Code adapter — drives `@anthropic-ai/claude-agent-sdk` `query()` in **streaming input
 * mode**: one persistent `Query` per session, fed through `AsyncMessageQueue`. This replaced a
 * single-message-per-turn + `resume` design: the CLI silently ignores a changed `model` option once
 * a session is resumed (verified against the live SDK), and streaming mode is the only channel for
 * mid-session control (`Query#setModel`, `#setPermissionMode`, `#interrupt`).
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
  /** True from prompt dispatch until its terminal `result`; a Query EOF while set is a failed turn. */
  private turnActive = false;
  /** Distinguishes an explicit adapter stop from an unexpected Query EOF. */
  private stopped = false;
  /** Session id to resume *once*, when the persistent Query starts from saved history — not updated
   * afterwards; the Query carries the conversation itself from there. */
  private resumeFrom: string | undefined;
  /** Suppresses `emitError` for the interrupt-induced stream failure `onCancel` triggers on purpose. */
  private cancelling = false;
  /** The effort the session should run at; applied at `Query` creation and on live switches. */
  private effort: EffortLevel | undefined;
  /** Whether settings enabled Ultracode before any explicit pick. The Stop hook reports only its
   * underlying xhigh level, so retain this bit until an accepted user selection replaces it. */
  private settingsUltracode = false;
  /** The approval policy the session runs under; applied at `Query` creation and on live switches.
   * `undefined` = no user pick — the CLI resolves its own default, reported back via init. */
  private approvalPolicy: ClaudeApprovalPolicyId | undefined;
  /** Provider session id sniffed off the last SDK message — the resume point when an effort
   * transition into/out of `max` forces a process restart (see `onSetEffort`). */
  private lastSessionRef: string | undefined;
  /** Diff content parsed off an Edit/Write announce, keyed by tool_use id; re-attached at settle
   * because `emitTool`'s merge replaces `content` wholesale (result text must not wipe the diff). */
  private readonly pendingEditDiffs = new Map<string, ToolCallContent[]>();
  /** The last compaction boundary, awaiting its summary: the swapped-in summary text arrives on a
   * separate user frame identified by the boundary's anchor uuid (see `handleCompactBoundary`). */
  private pendingCompaction: {
    event: Extract<AgentEvent, { type: 'compaction' }>;
    anchorUuid: string | undefined;
  } | null = null;
  /** The last published slash-command catalog — the alias authority for command interception
   * (`/cost` resolves to `/usage` via the provider's own aliases, not a hardcoded list). */
  private commandCatalog: AgentCommand[] = [];

  protected async onStart(opts: StartOptions): Promise<void> {
    this.stopped = false;
    const sdk = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    if (this.effort === undefined) {
      const { effective } = await sdk.resolveSettings({ cwd: opts.cwd });
      // The SDK documents `high` as Claude's provider default. A persisted setting wins, while the
      // Stop hook below later reconciles any model-specific downgrade made by the running CLI.
      this.settingsUltracode = effective.ultracode === true;
      this.emitEffort(this.settingsUltracode ? 'ultracode' : (effective.effortLevel ?? 'high'));
    }
    this.approvalPolicy ??= await settingsDefaultMode(opts.cwd);
    this.emitApprovalPolicy(this.approvalPolicyState());
    // Query init is the only authoritative slash-command catalog source: start the persistent
    // streaming Query with an empty queue so `/` commands are advertised before the first prompt.
    await this.createQuery();
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

  /** Reflect the served model the CLI reports (init message + every assistant frame) so the client
   * shows the true model even when the session started without a requested one. */
  private syncModel(model: string | undefined): void {
    if (model) this.emitModel(model);
  }

  /** Read-only `Stop` hook: learns the CLI's *resolved* effort after any per-model downgrade. The
   * hook reports Ultracode as its underlying xhigh level, so map only that pair back to the mode;
   * every other level is the actual downgrade. The field is absent without effort support. */
  private readonly reflectEffortHook: HookCallback = (input) => {
    if (input.effort?.level) {
      const parsed = EffortLevelSchema.safeParse(input.effort.level);
      if (parsed.success && parsed.data !== 'ultra') {
        const ultracode = this.effort === 'ultracode' || this.settingsUltracode;
        this.emitEffort(ultracode && parsed.data === 'xhigh' ? 'ultracode' : parsed.data);
      }
    }
    return Promise.resolve({ continue: true });
  };

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
    const [info, messages, subagentEvents, supplement] = await Promise.all([
      mod.getSessionInfo(opts.historyId),
      mod.getSessionMessages(opts.historyId, {
        limit: limit + 1,
        offset,
      }),
      readSubagentTranscripts(mod, opts.historyId),
      // Every page needs the raw transcript: getSessionMessages strips each result row's
      // structured toolUseResult, so the mapper re-attaches envelopes from here. The compaction
      // splice below stays first-page-only (the swapped-in summary is the SDK chain's head row).
      this.readTranscriptSupplement(opts.historyId),
    ]);
    const historyId = opts.historyId;
    const mapper = createClaudeHistoryEventMapper(
      historyId,
      supplement.records,
      supplement.toolUseResults,
    );
    const events: AgentHistoryEvent[] = [];
    // Splice each subagent's transcript right after its spawn announce so children land inside the
    // parent's turn (the UI's per-segment partition depends on it). Keyed off the in_progress
    // announce only — the settle re-emits the same id terminal. Recursive for nested spawns;
    // delete-before-recurse guards a malformed self-referential parent id looping forever.
    const pushWithSubagents = (event: AgentHistoryEvent): void => {
      events.push(event);
      if (
        event.event.type === 'tool-call' &&
        event.event.toolCall.kind === 'task' &&
        event.event.toolCall.status === 'in_progress'
      ) {
        const children = subagentEvents.get(event.event.toolCall.toolCallId);
        if (children) {
          subagentEvents.delete(event.event.toolCall.toolCallId);
          for (const child of children) pushWithSubagents(child);
        }
      }
    };
    const page = messages.slice(0, limit);
    // The SDK's chain walk starts at the newest compaction summary, dropping everything logically
    // before it. Prepend the rows recovered from the raw transcript ahead of the first page; rows
    // the SDK still returned (the preserved segment) are deduped by uuid. The dedup window is this
    // page only — safe because the preserved segment sits right after the summary head.
    const returned = new Set(page.map((message) => message.uuid));
    const dropped =
      offset === 0 ? supplement.droppedRows.filter((row) => !returned.has(row.uuid)) : [];
    for (const message of [...dropped, ...page]) {
      for (const event of mapper(message)) pushWithSubagents(event);
    }
    return {
      session: info
        ? mapClaudeHistorySession(info)
        : { historyId, kind: this.kind, title: historyId },
      events,
      cursor: cursorFromFetched(offset, messages.length, limit),
    };
  }

  /** Test seam over the raw transcript probe (see `readClaudeTranscriptSupplement`). */
  protected readTranscriptSupplement(sessionId: string): Promise<ClaudeTranscriptSupplement> {
    return readClaudeTranscriptSupplement(sessionId);
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    this.freshSegment();
    type ClaudeImageBlock = {
      type: 'image';
      source: { type: 'base64'; media_type: SupportedAttachmentImageMimeType; data: string };
    };
    const imageBlocksForClaude = imageBlocksFrom(content).reduce<ClaudeImageBlock[]>(
      (blocks, image) => {
        // The engine's attachment guard already rejected other types; the check here narrows our
        // schema's unconstrained mimeType string to the SDK's `Base64ImageSource.media_type` enum.
        if (isSupportedAttachmentImageMimeType(image.mimeType)) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType, data: image.data },
          });
        }
        return blocks;
      },
      [],
    );
    const text = contentToText(content);
    const messageContent: MessageParam['content'] =
      imageBlocksForClaude.length === 0
        ? text
        : [
            // The Messages API rejects an empty-string text block — an image-only send (allowed
            // by the composer) must carry the images alone.
            ...(text.length > 0 ? [{ type: 'text' as const, text }] : []),
            ...imageBlocksForClaude,
          ];
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: messageContent },
      parent_tool_use_id: null,
    };
    this.turnActive = true;
    this.emitStatus('running');
    try {
      if (this.inputQueue) {
        // Session already running: hand the SDK's own queued-message support the next turn.
        this.inputQueue.push(message);
        return;
      }
      // A crashed or deliberately rebuilt process is recreated on demand. Normal sessions already
      // own their Query from onStart so the command catalog is available before this first prompt.
      const queue = await this.createQuery();
      queue.push(message);
    } catch (error) {
      this.turnActive = false;
      this.teardown();
      this.emitStatus('idle');
      throw error;
    }
  }

  private async createQuery(): Promise<AsyncMessageQueue> {
    const opts = nullthrow(this.opts, 'claude-code: session not started');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const queue = new AsyncMessageQueue();
    // One-time use: the persistent Query carries the conversation itself from here on, so a later
    // Query created after a crash must not resume from this same (by then stale) point again.
    const resume = this.resumeFrom;
    // The SDK has no apiKey/baseURL option — the resolved account reaches the subprocess via `env`
    // (see `claudeCodeEnv` for the replace-vs-spread and omit-to-inherit semantics).
    const credentialEnv = claudeCodeEnv(env, readAgentCredential(opts.config));
    let q: Query | null = null;
    const reflectCurrentQueryEffort: HookCallback = (input, toolUseID, hookOptions) => {
      if (q === null || this.q !== q) return Promise.resolve({ continue: true });
      return this.reflectEffortHook(input, toolUseID, hookOptions);
    };
    q = query({
      prompt: queue,
      options: {
        cwd: opts.cwd,
        model: opts.model ?? undefined,
        // Bundled pair staged by the packaged host, else a detected user install (runtime-probe);
        // undefined in dev/standalone daemons, where the SDK resolves its own platform package.
        pathToClaudeCodeExecutable: agentRuntimeProber.resolveBinary('claude-code'),
        // `options.effort` becomes `--effort`, which outranks flag-settings for the process's whole
        // lifetime — passing it pins the level and makes every later applyFlagSettings switch a
        // silent no-op. Only `max` goes in here (the flag-settings key rejects it); other levels
        // apply through the switchable channel right after creation.
        effort: this.effort === 'max' ? 'max' : undefined,
        includePartialMessages: true,
        // Forward subagent text/thinking (tool_use/tool_result already flow by default) so the
        // client can render the nested transcript; all subagent frames carry parent_tool_use_id.
        forwardSubagentText: true,
        // Opus 4.6+ models default `thinking.display` to 'omitted' at the API — thinking blocks
        // arrive with EMPTY text (signature only), so no thought event would ever carry content
        // (CODE-273). The TUI shows thinking because interactive mode requests summaries; SDK mode
        // must ask explicitly. Ride the raw `--thinking-display` flag rather than the typed
        // `options.thinking`, which would also pin `--thinking adaptive` and override the CLI's
        // per-model thinking resolution (verified live on the 0.3.206 × 2.1.212 pair).
        extraArgs: { 'thinking-display': 'summarized' },
        // Read-only Stop hook reflecting the resolved effort (see `reflectEffortHook`).
        hooks: { Stop: [{ hooks: [reflectCurrentQueryEffort] }] },
        canUseTool: this.canUseTool,
        // Resolved in onStart via `settingsDefaultMode` — the SDK-driven CLI does not apply
        // settings.json itself. `undefined` = no pick anywhere; the CLI then starts in 'default'.
        permissionMode: this.approvalPolicy,
        // Gate flag only — the effective mode stays `permissionMode` above. It must be set at
        // startup for a later live switch to 'bypassPermissions' to be accepted at all.
        allowDangerouslySkipPermissions: true,
        resume,
        additionalDirectories: opts.additionalDirectories,
        ...(credentialEnv && { env: credentialEnv }),
      },
    });
    this.resumeFrom = undefined;
    this.q = q;
    this.inputQueue = queue;
    void this.consume(q);
    if (opts.model) {
      // `setModel` is an acknowledged streaming-mode control request. Reflect the startup pick only
      // after the CLI accepts it, so an unavailable model cannot masquerade as provider confirmation.
      await q.setModel(opts.model);
      this.emitModel(opts.model);
    }
    // Catalog discovery is optional and may wait on CLI initialization indefinitely. Do not hold
    // session.start behind it; publish whenever the snapshot becomes available.
    void this.publishCommands(q);
    if (this.effort !== undefined && this.effort !== 'max' && this.effort !== 'ultra') {
      try {
        await q.applyFlagSettings(effortFlagSettings(this.effort));
        this.emitEffort(this.effort);
      } catch (err) {
        // A stored level the CLI rejects (ultracode without dynamic workflows enabled) must not
        // fail the prompt or wedge later ones: drop it, report it, run at the CLI's default level.
        this.effort = undefined;
        this.emitError(extractErrorMessage(err) ?? 'claude-code: effort switch rejected');
      }
    } else if (this.effort === 'max') {
      this.emitEffort(this.effort);
    }
    return queue;
  }

  /** Runs for the whole session — not per turn — dispatching every message the persistent `Query`
   * emits. Returns only when the underlying process exits (crash, `close()`, or the CLI quitting). */
  private async consume(q: Query): Promise<void> {
    let streamError: unknown;
    try {
      for await (const msg of q) {
        if (this.q === q) this.handleMessage(msg);
      }
    } catch (err) {
      streamError = err;
    }
    // A deliberately rebuilt Query is detached before close. Its late unwind must not tear down or
    // emit idle into the newer Query's active turn.
    if (this.q !== q) return;
    this.q = null;
    this.inputQueue = null;
    const cancelling = this.cancelling;
    this.cancelling = false;
    const interruptedTurn = this.turnActive;
    this.turnActive = false;
    if (this.stopped) return;
    // Rebuild from the last provider session after a process/transport exit; `createQuery()` consumes
    // this once. Without re-arming it, an async spawn failure silently starts a new conversation.
    this.resumeFrom = this.lastSessionRef;
    if (!cancelling) {
      if (streamError !== undefined) {
        this.emitError(
          `claude-code: query failed (${extractErrorMessage(streamError) ?? 'unknown error'})`,
        );
      } else if (interruptedTurn) {
        this.emitError('claude-code: query ended before the turn returned a result');
      }
    }
    // The process is gone; finalize anything a mid-flight turn left dangling. Normal exits leave
    // the adapter idle; onCancel owns that transition while its interrupt request is still open.
    this.teardown();
    // onCancel keeps the engine gate closed until its interrupt round trip and base teardown finish.
    if (!cancelling) this.emitStatus('idle');
  }

  /** `supportedCommands()` is a snapshot captured at Query init — this fires once per Query to seed
   * the catalog; later changes arrive via the `commands_changed` push. A failed snapshot publishes
   * an authoritative empty catalog so host validation does not stay fail-open indefinitely. */
  private async publishCommands(q: Query): Promise<void> {
    try {
      const commands = await q.supportedCommands();
      if (this.q === q) this.publishCatalog(commands);
    } catch {
      if (this.q === q) this.publishCatalog([]);
    }
  }

  /** Normalize, cache (the alias authority for `isUsageCommand`), and broadcast the catalog. */
  private publishCatalog(commands: SlashCommand[]): void {
    this.commandCatalog = commands.map(mapClaudeCommand);
    this.emitCommands(this.commandCatalog);
  }

  /** Detach a Query before closing it so its late messages and consume() unwind cannot affect the
   * replacement. The next turn resumes from the last provider session id when one was observed. */
  private detachQueryForRebuild(q: Query): void {
    const queue = this.inputQueue;
    this.q = null;
    this.inputQueue = null;
    this.resumeFrom = this.lastSessionRef;
    q.close();
    queue?.close();
  }

  protected override async onCancel(): Promise<void> {
    const q = this.q;
    const hadTurn = this.turnActive;
    let interruptFailed = false;
    this.cancelling = true;
    this.turnActive = false;
    try {
      if (q) await q.interrupt();
      else this.cancelling = false;
    } catch {
      // No ack can delimit this turn's fallout. Clear the suppression flag and fall through to
      // detach the Query; otherwise a late result could still be mistaken for the next turn's.
      interruptFailed = true;
      this.cancelling = false;
    }
    // The interrupt ack can precede the cancelled turn's terminal result. If no result/EOF settled
    // while awaiting it, detach the old Query so that late fallout cannot settle the next turn.
    const settledWhileInterrupting =
      q !== null && hadTurn && !interruptFailed && (this.q !== q || !this.cancelling);
    if (settledWhileInterrupting) {
      this.teardown();
      this.emitStatus('idle');
      return;
    }
    if (q && hadTurn && this.q === q && !this.turnActive) {
      this.cancelling = false;
      this.detachQueryForRebuild(q);
    }
    // A prompt racing the interrupt round trip owns the running status and the live queue.
    if (this.turnActive) return;
    this.cancelling = false;
    this.teardown();
    this.emitStatus('idle');
  }

  protected override onStop(): Promise<void> {
    this.stopped = true;
    this.turnActive = false;
    this.q?.close();
    this.inputQueue?.close();
    return Promise.resolve();
  }

  /** Live model switch via `Query#setModel` (streaming-input-mode-only control request) — the CLI
   * ignores a changed `model` option once a session is resumed, so a resume-based design can't. */
  protected override async onSetModel(model: string): Promise<void> {
    const opts = nullthrow(this.opts, 'claude-code: session not started');
    if (this.q) await this.q.setModel(model);
    // Keep rebuilt Queries on the accepted live selection, rather than replaying the startup model.
    opts.model = model;
    // Reflect the pick immediately (the CLI accepted it, or it will apply at the next Query
    // creation); the served id off the next assistant frame reconciles it via `syncModel`.
    this.emitModel(model);
  }

  /** Live switch via `Query#setPermissionMode`. State reflects only after the CLI accepts, so a
   * rejected switch (e.g. auto mode unavailable for the account) leaves the previous policy shown. */
  protected override async onSetApprovalPolicy(policyId: string): Promise<void> {
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === policyId);
    if (!policy) throw new Error(`claude-code: unknown approval policy: ${policyId}`);
    if (this.q) await this.q.setPermissionMode(policy.policyId);
    this.approvalPolicy = policy.policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
  }

  /** Effort has two channels: low–xhigh and `ultracode` switch live via `Query#applyFlagSettings`
   * (the layer the CLI's `/effort` writes; see `effortFlagSettings`). `max` can only enter via the
   * `--effort` startup flag, which outranks flag-settings for the process's whole lifetime — so any
   * transition into or out of `max` closes the process and lets the next prompt rebuild the
   * `Query`, resuming in place via the session id sniffed off the last SDK message. */
  protected override async onSetEffort(effort: EffortLevel): Promise<void> {
    if (effort === 'ultra') {
      throw new Error("claude-code: effort 'ultra' is not supported");
    }
    const previous = this.effort;
    // Re-picking the current level is a no-op — it must not restart a live `max` process.
    if (effort === previous) return;
    if (!this.q) {
      this.effort = effort; // No process yet; onPrompt's Query creation applies it.
      this.settingsUltracode = false;
      return;
    }
    if (effort !== 'max' && previous !== 'max') {
      await this.q.applyFlagSettings(effortFlagSettings(effort));
      // Committed only after the CLI accepted the switch: a rejected one (ultracode without
      // dynamic workflows enabled) must not linger and get replayed onto a later rebuilt Query.
      this.effort = effort;
      this.settingsUltracode = false;
      this.emitEffort(effort);
      return;
    }
    this.effort = effort;
    this.settingsUltracode = false;
    // Detach before closing so a prompt racing the async consume() unwind creates the new Query
    // instead of pushing into the closed queue; consume()'s self-guard then skips its own cleanup.
    const q = this.q;
    // If the process died before any message carried a session id there is nothing to resume;
    // the rebuilt Query then simply starts fresh, keeping the same Link Code session.
    this.detachQueryForRebuild(q);
  }

  /** Invoking a command is pushing a plain user message through the existing prompt path: the
   * vendored CLI parses a leading "/" on every user message even in streaming-input mode (verified
   * against the vendored binary), so there is no separate "run this command" control request — a
   * command's status/settle rides the normal turn lifecycle exactly like a typed prompt.
   *
   * `/usage` (provider alias `/cost`) is the one exception: like Claude Code's own TUI — where it
   * opens a dialog and never writes to the transcript — it is intercepted into a structured
   * `usage-report` event instead of a turn. No `result` frame will follow, so `reportUsage`
   * brackets itself with status `running`→`idle` per the base.ts turn contract — the busy window
   * (the control request is network-bound and can span a process respawn) stays visible to the
   * composer, and the engine's input gate releases at send()-resolve because status is already
   * back to idle. */
  protected override onCommand(name: string, args?: string): Promise<void> {
    if (this.isUsageCommand(name)) return this.reportUsage();
    const text = `/${name}${args ? ` ${args}` : ''}`;
    return this.onPrompt([textBlock(text)]);
  }

  /** True when `name` invokes the provider's `usage` command — canonical name or alias, resolved
   * against the advertised catalog. Catalog discovery is async and may still be pending on an
   * early invocation; until it lands only the literal name matches. */
  private isUsageCommand(name: string): boolean {
    const usage = this.commandCatalog.find((command) => command.name === 'usage');
    return usage ? agentCommandMatches(usage, name) : name === 'usage';
  }

  /** Serve `/usage` from the SDK's get-usage control request (the structured data behind the CLI's
   * own usage dialog). The SDK marks the method EXPERIMENTAL — its very name says it will be
   * renamed on stabilization — so the call is feature-detected and isolated here plus
   * `mapClaudeUsageReport`; an SDK/CLI pair that dropped or renamed it degrades to a session
   * error, never a silent no-op. No text fallback by design: the invocation must never surface as
   * transcript text. Verified against SDK 0.3.206 × CLI 2.1.206. */
  private async reportUsage(): Promise<void> {
    // Announce the busy window synchronously (base.ts turn contract): the engine's input gate and
    // the composer both read status, and without this the session looks idle while a concurrent
    // input gets rejected with "Session is busy". No result frame follows an intercepted command,
    // so the matching 'idle' is also emitted here (finally) — success and failure alike.
    this.emitStatus('running');
    try {
      // Same lazy recovery as onPrompt: a crashed or deliberately rebuilt process (an effort
      // transition into/out of max) is recreated on demand, so /usage works right after either.
      if (!this.q) await this.createQuery();
      const q = nullthrow(this.q, 'claude-code: session not started');
      if (typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== 'function') {
        throw new TypeError('the get-usage control request is unavailable on this SDK');
      }
      const raw = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
      this.emitUsageReport(mapClaudeUsageReport(raw));
    } catch (err) {
      this.emitError(`claude-code: /usage failed (${extractErrorMessage(err) ?? 'unknown error'})`);
    } finally {
      this.emitStatus('idle');
    }
  }

  /** A cancelled/failed turn never delivers the matching tool_results; drop their stashed diffs.
   * A compaction's summary frame also never outlives its turn — drop a stale boundary stash so
   * the summary match can't fire against an unrelated later frame. */
  protected override teardown(): void {
    this.pendingEditDiffs.clear();
    this.pendingCompaction = null;
    super.teardown();
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName === 'AskUserQuestion') {
      const questions = ASK_USER_QUESTION_INPUT.safeParse(input);
      // A parse failure means the pinned CLI's tool shape drifted; degrade to the generic
      // allow/deny ask (allow then executes with empty answers) instead of failing the turn.
      if (questions.success) {
        return this.askUserQuestion(questions.data.questions, input, options.toolUseID);
      }
    }
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

  /** AskUserQuestion executes with whatever answers the host writes into its input — an allow with
   * no `answers` "succeeds" with every question unanswered. The ask surfaces as a question card and
   * the picks fold back into `updatedInput.answers`, keyed by the question's own text (the CLI's
   * answer-record key; multi-select labels joined with ', ' per the tool's output contract). */
  private async askUserQuestion(
    questions: z.infer<typeof ASK_USER_QUESTION_INPUT>['questions'],
    input: Record<string, unknown>,
    toolUseID: string,
  ): Promise<PermissionResult> {
    const outcome = await this.requestQuestion(
      {
        toolCallId: toolUseID,
        title: 'AskUserQuestion',
        kind: claudeToolKind('AskUserQuestion'),
        rawInput: input,
      },
      questions.map((question, qi) => ({
        questionId: `q${qi}`,
        prompt: question.question,
        header: question.header,
        multiSelect: question.multiSelect ?? false,
        options: question.options.map((option, oi) => ({
          optionId: `o${oi}`,
          label: option.label,
          description: option.description,
        })),
      })),
    );
    if (outcome.outcome === 'cancelled') {
      return { behavior: 'deny', message: 'User declined to answer questions' };
    }
    const byQuestionId = new Map(outcome.answers.map((answer) => [answer.questionId, answer]));
    const answers: Record<string, string> = {};
    for (const [qi, question] of questions.entries()) {
      const answer = byQuestionId.get(`q${qi}`);
      if (!answer) continue;
      const selected = new Set(answer.selectedOptionIds);
      const labels: string[] = [];
      for (const [oi, option] of question.options.entries()) {
        if (selected.has(`o${oi}`)) labels.push(option.label);
      }
      const value = answer.customText?.trim() || labels.join(', ');
      if (value) answers[question.question] = value;
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  protected handleMessage(msg: SDKMessage): void {
    // Every SDK message carries the CLI's session id — the provider-local history id this live run
    // writes to. Sniffed before the replay guard so a resumed session binds immediately.
    if (typeof msg.session_id === 'string' && msg.session_id.length > 0) {
      this.lastSessionRef = msg.session_id;
      this.emitSessionRef(asHistoryId(msg.session_id));
    }
    // The compaction summary rides as an isReplay-flagged user frame right after the boundary
    // (verified live against 0.3.179) — catch it before the replay guard below drops it.
    if (msg.type === 'user' && this.isCompactionSummary(msg)) {
      const compaction = nullthrow(this.pendingCompaction, 'checked by isCompactionSummary');
      const summary = plainTextContent(msg.message.content);
      if (summary) this.emit({ ...compaction.event, summary });
      this.pendingCompaction = null;
      return;
    }
    // A history-resumed session replays prior turns as `isReplay` frames right after Query
    // creation; re-emitting them live would flood the stream and pollute the tool-call snapshot map.
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
        // from the Task tool_use/tool_result pair (task_id correlation only pays off once
        // run_in_background tasks are supported).
        // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (other subtypes are ignored); the switch autofix then trips the error-level default-case rule
        if (msg.subtype === 'permission_denied') this.handlePermissionDenied(msg);
        else if (msg.subtype === 'compact_boundary') this.handleCompactBoundary(msg);
        else if (msg.subtype === 'init') {
          this.syncApprovalPolicy(msg.permissionMode);
          this.syncModel(msg.model);
        } else if (msg.subtype === 'commands_changed') {
          // Fire-and-forget full-replace push (`supportedCommands()` is captured once at init and
          // never reflects mid-session changes) — swap the cached catalog wholesale.
          this.publishCatalog(msg.commands);
        } else if (msg.subtype === 'local_command_output') {
          // A local command (e.g. /voice) produces no assistant frame of its own; the SDK's own doc
          // comment says to display it "as assistant-style text in the transcript". Bracket it in
          // its own segment so it never merges with narration on either side of it — the command
          // invocation itself (`onCommand`) rides the normal prompt path and its status/settle
          // comes from the matching `result` frame like any other turn (verified live: a local
          // command still ends in a normal zero-token `result`, not a distinct settle shape).
          // `/usage` no longer reaches this path — it is intercepted in `onCommand` (`reportUsage`).
          this.freshSegment();
          this.emitAssistantText(msg.content, this.messageId);
          this.freshSegment();
        }
        break;
      default:
        break;
    }
  }

  /**
   * A compaction boundary: the session (and its id) continue unchanged — only the model's context
   * was swapped (verified live: `session_id` is identical across the boundary). Announce the marker
   * immediately; the summary follows on a separate user frame matched by the boundary's anchor uuid
   * and re-emits the same `compactionId` with `summary` attached (consumers merge).
   */
  private handleCompactBoundary(msg: SDKCompactBoundaryMessage): void {
    const meta = msg.compact_metadata;
    const event = {
      type: 'compaction' as const,
      compactionId: msg.uuid,
      trigger: meta.trigger,
      preTokens: meta.pre_tokens,
      postTokens: meta.post_tokens,
    };
    this.pendingCompaction = {
      event,
      anchorUuid: meta.preserved_messages?.anchor_uuid ?? meta.preserved_segment?.anchor_uuid,
    };
    this.emit(event);
  }

  /** The pending compaction's summary frame: matched by the anchor uuid, or — when the compaction
   * left no anchor — the next synthetic user frame. Deliberately not a type predicate: its `false`
   * branch must not narrow `user` frames out of `handleMessage`'s union. */
  private isCompactionSummary(msg: Extract<SDKMessage, { type: 'user' }>): boolean {
    if (!this.pendingCompaction) return false;
    const anchor = this.pendingCompaction.anchorUuid;
    if (anchor) return msg.uuid === anchor;
    return msg.isSynthetic === true;
  }

  /** An auto-denied tool (auto-mode classifier, deny rule, …) never reaches `canUseTool`; this SDK
   * event is the only carrier of the decider's reason. Settle the tool as failed with it — the
   * later `is_error` tool_result says only "denied" and hits `emitTool`'s terminal guard anyway. */
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
    // Every assistant frame carries the served model — the source of truth for a mid-session switch
    // (`init` fires only at Query creation, so it can't catch a live `setModel`).
    this.syncModel(message.model);
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
          locations: hostLocationsFromToolInput(block.input),
        });
        calledTool = true;
      }
    }
    // A tool call closes this assistant segment; text Claude streams after the tool_result groups into a
    // fresh bubble rather than merging with the pre-tool narration.
    if (calledTool) this.freshSegment();
  }

  /**
   * A subagent's assistant frame (`parent_tool_use_id` set): tool calls carry the spawning Task's
   * id; text/thinking render message-level under the frame's own uuid (which doubles as the history
   * mapper's id, so live and cold-resume converge). It never touches the main message/thought
   * cursors or calls `freshSegment()`, so a mid-turn subagent can't break the main streaming bubble.
   */
  private handleSubagentAssistant(message: AssistantMessage, parent: string, uuid: string): void {
    for (const block of message.content) {
      // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (other block variants are ignored); the switch autofix then trips the error-level default-case rule
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
          locations: hostLocationsFromToolInput(block.input),
        });
      } else if (block.type === 'text') {
        this.emitAssistantText(block.text, asMessageId(uuid), parent);
      } else if (block.type === 'thinking') {
        this.emitThought(block.thinking, asMessageId(`${uuid}:think`), parent);
      }
    }
  }

  /**
   * Tool results come back on the *user* message. A denied permission lands here too — the SDK
   * synthesizes an `is_error` result — so one branch settles success, failure, and deny alike.
   */
  private handleUser(msg: UserSDKMessage): void {
    const content = msg.message.content;
    if (typeof content === 'string') return;
    // tool_use_result is message-level; only an unambiguous single-result frame can claim it.
    const results = content.filter((block) => block.type === 'tool_result');
    const envelope = results.length === 1 ? toolUseResultEnvelope(msg.tool_use_result) : undefined;
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
        rawOutput: envelope ?? block.content,
      });
    }
  }

  /** A `result` message ends one turn — not the session, which spans the whole `consume()` loop —
   * so per-turn cleanup happens here. */
  private handleResult(msg: ResultMessage): void {
    const cancelling = this.cancelling;
    this.cancelling = false;
    this.turnActive = false;
    if (msg.subtype === 'success') {
      // A 401 comes back as a `success` result carrying `api_error_status` (CODE-75) — surface it
      // as a non-recoverable auth error driving the daemon's login re-probe, not usage + a phantom stop.
      if (msg.api_error_status === 401) {
        this.emitError(
          'Claude authentication failed — sign in to Claude',
          AUTH_FAILED_ERROR_CODE,
          false,
        );
        this.teardown();
        if (!cancelling) this.emitStatus('idle');
        return;
      }
      const usage = isRecord(msg.usage) ? msg.usage : {};
      this.emitUsage({
        inputTokens: numberField(usage, 'input_tokens'),
        outputTokens: numberField(usage, 'output_tokens'),
        cacheReadTokens: numberField(usage, 'cache_read_input_tokens'),
        cacheCreationTokens: numberField(usage, 'cache_creation_input_tokens'),
        totalCostUsd: msg.total_cost_usd,
      });
      this.emitStop(mapClaudeStop(msg.stop_reason));
    } else if (cancelling) {
      // This non-success result is the fallout of our own onCancel()'s interrupt(), not a real
      // failure — consume the flag instead of surfacing it as an error.
    } else {
      this.emitError(claudeResultErrorMessage(msg), undefined, true);
    }
    this.teardown();
    // A result can beat interrupt()'s control ack. Keep the gate closed until onCancel returns so
    // base send(cancel)'s final teardown cannot sweep a newly admitted turn.
    if (!cancelling) this.emitStatus('idle');
  }
}

/** `locationsFromToolInput` with the CLI's MSYS drive-form spellings (`/c/…`, reported when it
 * routes through Git Bash on Windows) rewritten to native form. Claude-scoped on purpose: no
 * other adapter is confirmed to emit the form. */
function hostLocationsFromToolInput(input: unknown): ToolCallLocation[] | undefined {
  return locationsFromToolInput(input)?.map((location) => ({
    ...location,
    path: toHostPath(location.path),
  }));
}

/**
 * Surface Edit/Write inputs (which carry the exact patch) as structured diff content so the UI
 * renders a diff instead of raw input JSON; Write has no oldText (whole-file, renders all-added).
 * Undefined for every other tool (NotebookEdit has no old cell source to diff) and malformed input.
 */
function editDiffContent(toolName: string, input: unknown): ToolCallContent[] | undefined {
  if (!isRecord(input)) return undefined;
  if (toolName === 'Edit') {
    const { file_path: path, old_string: oldText, new_string: newText } = input;
    if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
      return undefined;
    }
    // The CLI on Windows reports MSYS drive-form paths (`/c/…`) — rewrite to native form.
    return [{ type: 'diff', path: toHostPath(path), oldText, newText }];
  }
  if (toolName === 'Write') {
    const { file_path: path, content: newText } = input;
    if (typeof path !== 'string' || typeof newText !== 'string') return undefined;
    return [{ type: 'diff', path: toHostPath(path), newText }];
  }
  return undefined;
}

const TOOL_USE_RESULT_SCALAR_MAX = 256;

/**
 * Claude pairs every tool_result with a structured `tool_use_result` (live SDK user frames and raw
 * transcript rows both carry it; `getSessionMessages` strips it). It mixes small envelope fields
 * the UI wants (WebFetch `code`/`codeText`/`durationMs`/`bytes`, ToolSearch counts) with bulk
 * payloads duplicating the result content (`originalFile`, `file.content`, `stdout`). Project only
 * the scalars onto `rawOutput`: badges need them, and re-shipping whole files in every settle frame
 * is pure bloat. Strings above the cap are payload, not envelope.
 */
export function toolUseResultEnvelope(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const envelope: Record<string, unknown> = {};
  let fields = 0;
  for (const [key, field] of Object.entries(value)) {
    const scalar =
      typeof field === 'string'
        ? field.length > 0 && field.length <= TOOL_USE_RESULT_SCALAR_MAX
        : typeof field === 'number' || typeof field === 'boolean';
    if (!scalar) continue;
    envelope[key] = field;
    fields += 1;
  }
  return fields > 0 ? envelope : undefined;
}

/** Normalize a tool_result's payload (string or content blocks) into tool-call content. Accepts
 * `unknown` because it also runs over untyped transcript rows, not only live SDK messages.
 * ToolSearch settles with `tool_reference` blocks and no text at all; flatten those to one
 * name-per-line text block so the call doesn't render as an empty result. */
function toolResultContent(content: unknown): ToolCallContent[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'content', content: textBlock(content) }] : [];
  }
  if (!Array.isArray(content)) return [];
  const toolReferences: string[] = [];
  const items = content.reduce<ToolCallContent[]>((items, block) => {
    if (!isRecord(block)) return items;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      items.push({ type: 'content', content: textBlock(block.text) });
    } else if (
      block.type === 'tool_reference' &&
      typeof block.tool_name === 'string' &&
      block.tool_name.length > 0
    ) {
      toolReferences.push(block.tool_name);
    }
    return items;
  }, []);
  if (toolReferences.length > 0) {
    items.push({ type: 'content', content: textBlock(toolReferences.join('\n')) });
  }
  return items;
}

/** Flatten a user message's payload (string or API content blocks) into plain text — the shape a
 * compaction summary travels in, both live and on disk. */
function plainTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('\n');
}

/** A session id becomes a transcript filename — only uuid-shaped ids are probed on disk. */
const SAFE_SESSION_ID = /^[\w-]+$/;

export interface ClaudeCompactionRecord {
  compactionId: string;
  trigger?: 'manual' | 'auto';
  preTokens?: number;
  postTokens?: number;
}

/** What the raw transcript knows that the SDK read API loses. */
export interface ClaudeTranscriptSupplement {
  /** Swapped-in-summary row uuid → its boundary's record, for the mapper to turn the summary row
   * into a compaction marker instead of a fake user prompt. */
  records: Map<string, ClaudeCompactionRecord>;
  /** The pre-compaction rows `getSessionMessages` drops (its chain walk starts at the newest
   * summary, whose `parentUuid` is null — `logicalParentUuid` is ignored). In file (= chronological)
   * order; rows the SDK still returns (the preserved segment) are deduped by uuid at read time. */
  droppedRows: SessionMessage[];
  /** tool_use_id → projected `toolUseResult` envelope (`toolUseResultEnvelope`), another field
   * `getSessionMessages` strips per row. Keyed only for unambiguous single-result rows. */
  toolUseResults: Map<string, Record<string, unknown>>;
}

/**
 * Recover, from raw transcript lines, what the SDK read API strips (verified against SDK 0.3.179;
 * `toolUseResult` re-verified on 0.3.206). On disk a compaction is a `system/compact_boundary` row
 * (camelCase `compactMetadata`) followed by an `isCompactSummary:true` user row carrying the
 * swapped-in summary; a boundary claims the next summary row. `getSessionMessages` keeps only
 * type/uuid/session_id/message/parent_tool_use_id/timestamp per row — the boundary's metadata, the
 * summary flag, and each result row's structured `toolUseResult` never survive — and its chain
 * reconstruction drops every row logically before the newest summary, so the marker, the
 * pre-compaction timeline, and the result envelopes must all come from here.
 */
export function buildClaudeTranscriptSupplement(
  lines: Iterable<string>,
): ClaudeTranscriptSupplement {
  const records = new Map<string, ClaudeCompactionRecord>();
  const toolUseResults = new Map<string, Record<string, unknown>>();
  /** Conversation rows in file order, with the index of the last boundary seen before each. */
  const rows: Array<{ row: TimestampedSessionMessage; boundariesBefore: number }> = [];
  let boundaries = 0;
  let pending: ClaudeCompactionRecord | null = null;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Torn/corrupt line (e.g. a write in progress) — skip, like the SDK's own reader.
    }
    if (!isRecord(parsed) || typeof parsed.uuid !== 'string' || parsed.uuid.length === 0) continue;
    const row = parsed;
    const uuid = parsed.uuid;
    if (row.type === 'system' && row.subtype === 'compact_boundary') {
      boundaries += 1;
      const meta = isRecord(row.compactMetadata) ? row.compactMetadata : {};
      pending = {
        compactionId: uuid,
        trigger: meta.trigger === 'manual' || meta.trigger === 'auto' ? meta.trigger : undefined,
        preTokens: numberField(meta, 'preTokens'),
        postTokens: numberField(meta, 'postTokens'),
      };
      continue;
    }
    if (row.type === 'user' && row.isCompactSummary === true) {
      // A summary row with no preceding boundary (torn write) still marks a compaction, keyed by
      // its own uuid with no metadata. The row also joins the conversation rows: an EARLIER
      // summary is itself chain-dropped, and replaying it restores that compaction's marker.
      records.set(uuid, pending ?? { compactionId: uuid });
      pending = null;
    } else if (row.type !== 'user' && row.type !== 'assistant') continue;
    // Harvested before the exclusions: tool_use ids are globally unique, so keying a row the
    // timeline itself skips is harmless.
    if (row.type === 'user') harvestToolUseResult(toolUseResults, row);
    // Same exclusions as the SDK's own reader: meta rows, sidechains, and teammate rows.
    if (row.isMeta === true || row.isSidechain === true || row.teamName) continue;
    rows.push({
      row: {
        type: row.type,
        uuid,
        session_id: typeof row.sessionId === 'string' ? row.sessionId : '',
        message: row.message,
        parent_tool_use_id: null,
        parent_agent_id: null,
        ...(typeof row.timestamp === 'string' && { timestamp: row.timestamp }),
      },
      boundariesBefore: boundaries,
    });
  }
  return {
    records,
    // Only rows before the last boundary are dropped by the SDK's chain walk; the rest of the
    // timeline (summary head onward) comes back from getSessionMessages as usual.
    droppedRows: rows.reduce<SessionMessage[]>((dropped, r) => {
      if (r.boundariesBefore < boundaries) dropped.push(r.row);
      return dropped;
    }, []),
    toolUseResults,
  };
}

/** Key a raw result row's `toolUseResult` envelope by its tool_use id. The field is row-level, so
 * only a row with exactly one tool_result block pairs unambiguously. */
function harvestToolUseResult(
  map: Map<string, Record<string, unknown>>,
  row: Record<string, unknown>,
): void {
  const envelope = toolUseResultEnvelope(row.toolUseResult);
  if (!envelope) return;
  const message = isRecord(row.message) ? row.message : undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return;
  const ids = content.reduce<string[]>((ids, block) => {
    if (isRecord(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      ids.push(block.tool_use_id);
    }
    return ids;
  }, []);
  if (ids.length === 1) map.set(ids[0], envelope);
}

/**
 * Locate the session's transcript and build its supplement. `readHistory` carries no cwd, so —
 * mirroring `getSessionMessages` without `dir` — every project dir is probed for
 * `<sessionId>.jsonl` (the id is unique, so at most one probe succeeds). Any failure degrades to
 * an empty supplement: history still reads, just without compaction markers or result envelopes.
 */
async function readClaudeTranscriptSupplement(
  sessionId: string,
): Promise<ClaudeTranscriptSupplement> {
  // The id becomes a filename — refuse anything that could traverse out of the projects dir.
  if (!SAFE_SESSION_ID.test(sessionId)) return EMPTY_SUPPLEMENT;
  const projectsDir = path.join(homedir(), '.claude', 'projects');
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return EMPTY_SUPPLEMENT;
  }
  const texts = await Promise.all(
    dirs.map((dir) =>
      readFile(path.join(projectsDir, dir, `${sessionId}.jsonl`), 'utf8').catch(() => null),
    ),
  );
  const text = texts.find((t) => t !== null);
  return text ? buildClaudeTranscriptSupplement(text.split('\n')) : EMPTY_SUPPLEMENT;
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
 * Subagent transcripts (`subagents/agent-{id}.jsonl`) are not part of `getSessionMessages`. Every
 * `getSubagentMessages` row carries `parent_tool_use_id` — the spawning Task/Agent tool_use id
 * (verified against the vendored SDK's on-disk format) — so the history mapper reproduces the live
 * stream's parent-linked events. Keyed by that parent id for splicing after the spawn announce.
 */
async function readSubagentTranscripts(
  mod: typeof import('@anthropic-ai/claude-agent-sdk'),
  sessionId: string,
): Promise<Map<string, AgentHistoryEvent[]>> {
  const agentIds = await mod.listSubagents(sessionId);
  const byParent = new Map<string, AgentHistoryEvent[]>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const rows = await mod.getSubagentMessages(sessionId, agentId, { limit: 1000 });
      const parent = rows.find((row) => row.parent_tool_use_id !== null)?.parent_tool_use_id;
      if (!parent) return;
      byParent.set(parent, rows.flatMap(createClaudeHistoryEventMapper(asHistoryId(sessionId))));
    }),
  );
  return byParent;
}

/**
 * Stateful per-read mapper: correlates each `tool_use` announce with its settling `tool_result`,
 * replaying the live path's announce/settle snapshot pairs under the provider's `toolu_` ids so a
 * seeded timeline and live re-emits converge by id (`buildConversation` replaces by id).
 */
/** `getSessionMessages` rows (and the supplement's raw rows) carry an ISO `timestamp` at runtime
 * that the SDK's `SessionMessage` type omits — verified live on 0.3.206. */
type TimestampedSessionMessage = SessionMessage & { timestamp?: string };

export function createClaudeHistoryEventMapper(
  historyId: AgentHistoryId,
  compactions?: ReadonlyMap<string, ClaudeCompactionRecord>,
  /** Result envelopes recovered from the raw transcript (`ClaudeTranscriptSupplement`) —
   * getSessionMessages strips them, so replayed settles read theirs from here. */
  toolUseResults?: ReadonlyMap<string, Record<string, unknown>>,
): (message: SessionMessage) => AgentHistoryEvent[] {
  const announced = new Map<string, ToolCall>();
  /** Last model announced to the timeline; assistant rows re-announce only on change. */
  let lastModel: string | undefined;

  return (message) => {
    if (message.type !== 'user' && message.type !== 'assistant') return [];
    const ts = timestampMs((message as TimestampedSessionMessage).timestamp);
    const toolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
      announced.set(toolCall.toolCallId, toolCall);
      return { historyId, itemId: toolCall.toolCallId, ts, event: { type: 'tool-call', toolCall } };
    };
    // A compaction's swapped-in summary is stored as a user row; replaying it as a user prompt
    // would fake a giant user turn (CODE-141). It becomes the compaction marker in place instead.
    const compaction = message.type === 'user' ? compactions?.get(message.uuid) : undefined;
    if (compaction) {
      const summary = plainTextContent(
        isRecord(message.message) ? message.message.content : undefined,
      );
      return [
        {
          historyId,
          itemId: compaction.compactionId,
          ts,
          event: { type: 'compaction', ...compaction, ...(summary && { summary }) },
        },
      ];
    }
    const events: AgentHistoryEvent[] = [];
    const blocks = messageContentBlocks(message.message);
    // Subagent transcript rows carry the spawning Task's tool_use id, same as live frames.
    const parent = message.parent_tool_use_id ?? undefined;

    if (message.type === 'assistant') {
      // Every assistant row records the model that served it; replay it as the same model-update
      // the live stream emits so seeded messages get their per-turn model stamp. Subagent rows
      // are skipped — their model must not masquerade as the session's.
      const model =
        !parent && isRecord(message.message) ? stringField(message.message, 'model') : undefined;
      if (model && model !== lastModel) {
        lastModel = model;
        events.push({ historyId, ts, event: { type: 'model-update', model } });
      }
      // Thinking replays as thought chunks under `${uuid}:think` — the id the live subagent path
      // already emits, so live-forwarded and cold-replayed thinking converge. Pre-CODE-273
      // transcripts store empty thinking text; the helper's empty-drop rule skips those.
      for (const block of blocks) {
        if (!isThinkingBlock(block)) continue;
        const thought = thoughtHistoryEvent(
          historyId,
          `${message.uuid}:think`,
          block.thinking,
          ts,
          parent,
        );
        if (thought) events.push(thought);
      }
      const text = textHistoryEvent(
        historyId,
        'assistant',
        message.uuid,
        message.message,
        ts,
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
          rawOutput: toolUseResults?.get(block.tool_use_id) ?? block.content,
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
    const text = textHistoryEvent(historyId, 'user', message.uuid, promptValue, ts);
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

interface ClaudeThinkingBlock {
  type: 'thinking';
  thinking: string;
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

function isThinkingBlock(block: unknown): block is ClaudeThinkingBlock {
  return isRecord(block) && block.type === 'thinking' && typeof block.thinking === 'string';
}
