import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CanUseTool,
  HookCallback,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
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
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentHistorySession,
  AgentStartCatalog,
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  McpServer,
  PermissionOption,
  StartOptions,
  StopReason,
  SupportedAttachmentImageMimeType,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  UnifiedDiffHunk,
  UsageRateLimitWindow,
  UsageReport,
} from '@linkcode/schema';
import {
  agentCommandMatches,
  EffortLevelSchema,
  isSupportedAttachmentImageMimeType,
  textBlock,
  UsageReportSchema,
  unifiedPatchText,
} from '@linkcode/schema';
import { asyncRetry } from 'foxts/async-retry';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { waitWithAbort } from 'foxts/wait';
import { z } from 'zod';
import type { AgentStartCatalogOptions, BrowserToolset, BrowserToolsetFactory } from '../adapter';
import { AUTH_FAILED_ERROR_CODE, renderBrowserToolResult } from '../adapter';
import { BaseAgentAdapter } from '../base';
import { claudeCodeEnv, readAgentCredential } from '../credential';
import { decodeHistoryBranchCursor, encodeHistoryBranchCursor } from '../history-branch';
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
import { resolveAgentShellEnvironment } from '../shell-env';
import { contentToText, imageBlocksFrom, locationsFromToolInput, toolKindFromName } from '../util';

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
  for (let i = 0, len = files.length; i < len; i++) {
    const file = files[i];
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

/** Map wire `McpServer` entries onto the SDK's keyed record shape (undefined when none). */
export function claudeMcpServers(
  servers: McpServer[] | undefined,
): Record<string, McpServerConfig> | undefined {
  if (!servers?.length) return undefined;
  const out: Record<string, McpServerConfig> = {};
  for (let i = 0, len = servers.length; i < len; i++) {
    const server = servers[i];
    out[server.name] =
      server.type === 'http'
        ? { type: 'http', url: server.url, ...(server.headers && { headers: server.headers }) }
        : {
            type: 'stdio',
            command: server.command,
            ...(server.args && { args: server.args }),
            ...(server.env && { env: server.env }),
          };
  }
  return out;
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
  push('seven_day', 10080, limits.seven_day);
  push('seven_day_oauth_apps', 10080, limits.seven_day_oauth_apps);
  push('seven_day_opus', 10080, limits.seven_day_opus);
  push('seven_day_sonnet', 10080, limits.seven_day_sonnet);
  if (limits.model_scoped != null) {
    for (let i = 0, len = limits.model_scoped.length; i < len; i++) {
      const bucket = limits.model_scoped[i];
      windows.push({
        label: bucket.display_name,
        utilization: bucket.utilization,
        resetsAt: bucket.resets_at,
        durationMins: 10080,
      });
    }
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
      modelUsage: Object.entries(raw.session.model_usage).reduce<
        Record<
          string,
          {
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
            totalCostUsd: number;
          }
        >
      >((acc, [model, usage]) => {
        acc[model] = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadInputTokens,
          cacheCreationTokens: usage.cacheCreationInputTokens,
          totalCostUsd: usage.costUSD,
        };
        return acc;
      }, {}),
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
  parentUuidByUuid: new Map(),
  toolUses: new Map(),
  toolUseResults: new Map(),
  toolUsePatches: new Map(),
};

const TITLE_POLL_INITIAL_DELAY_MS = 500;
const TITLE_POLL_RETRIES = 3;
const TITLE_POLL_RETRY_DELAY_MS = 1000;

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
    branch: true,
  };

  private q: Query | null = null;
  private inputQueue: AsyncMessageQueue | null = null;
  private processEnvironment: NodeJS.ProcessEnv | null = null;
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
  private getSessionInfo:
    | ((sessionId: string, options?: { dir?: string }) => Promise<SDKSessionInfo | undefined>)
    | undefined;
  private titlePollStarted = false;
  private titlePollController: AbortController | null = null;
  /** The last compaction boundary, awaiting its summary: the swapped-in summary text arrives on a
   * separate user frame identified by the boundary's anchor uuid (see `handleCompactBoundary`). */
  private pendingCompaction: {
    event: Extract<AgentEvent, { type: 'compaction' }>;
    anchorUuid: string | undefined;
  } | null = null;
  /** The last published slash-command catalog — the alias authority for command interception
   * (`/cost` resolves to `/usage` via the provider's own aliases, not a hardcoded list). */
  private commandCatalog: AgentCommand[] = [];
  private browserTools: BrowserToolsetFactory | undefined;
  /** One persistent REPL toolset per LinkCode session. SDK MCP wrappers remain Query-scoped. */
  private browserToolset: BrowserToolset | undefined;

  attachBrowserTools(createToolset: BrowserToolsetFactory): void {
    this.browserTools = createToolset;
    this.browserToolset = undefined;
  }

  private async buildBrowserMcpServer(): Promise<Record<string, McpSdkServerConfigWithInstance>> {
    const factory = nullthrow(this.browserTools, 'claude-code: browser tools not attached');
    const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
    let toolset = this.browserToolset;
    if (!toolset) {
      toolset = factory();
      this.browserToolset = toolset;
    }
    return {
      linkcode_browser: createSdkMcpServer({
        name: 'linkcode_browser',
        tools: [
          tool(
            'execute',
            toolset.documentation,
            { code: z.string().describe('JavaScript for the persistent browser REPL') },
            async ({ code }) => {
              const rendered = renderBrowserToolResult(await toolset.execute(code));
              return {
                content: [
                  { type: 'text' as const, text: rendered.text },
                  ...(rendered.image
                    ? [
                        {
                          type: 'image' as const,
                          data: rendered.image.base64,
                          mimeType: rendered.image.mimeType,
                        },
                      ]
                    : []),
                ],
              };
            },
          ),
        ],
      }),
    };
  }

  protected async onStart(opts: StartOptions): Promise<void> {
    this.stopped = false;
    this.processEnvironment = await resolveAgentShellEnvironment(opts.cwd);
    const sdk = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    this.getSessionInfo = Object.hasOwn(sdk, 'getSessionInfo') ? sdk.getSessionInfo : undefined;
    if (this.resumeFrom && this.getSessionInfo) {
      try {
        const info = await this.getSessionInfo(this.resumeFrom, { dir: opts.cwd });
        const title = generatedClaudeTitle(info);
        if (title) this.emitTitle(title);
      } catch {
        // Metadata is best-effort; a title read must not prevent the conversation from resuming.
      }
    }
    if (this.effort === undefined) {
      const { effective } = await sdk.resolveSettings({ cwd: opts.cwd });
      // The SDK documents `high` as Claude's provider default. A persisted setting wins, while the
      // Stop hook below later reconciles any model-specific downgrade made by the running CLI.
      this.settingsUltracode = effective.ultracode === true;
      this.emitEffort(this.settingsUltracode ? 'ultracode' : (effective.effortLevel ?? 'high'));
    }
    // A new-session pick outranks the settings default; an unknown tier degrades to that default
    // with an error event rather than failing session creation.
    if (opts.approvalPolicyId) {
      const picked = APPROVAL_POLICIES.find((p) => p.policyId === opts.approvalPolicyId);
      if (picked) this.approvalPolicy = picked.policyId;
      else {
        this.emitError(
          `claude-code: unknown approval policy '${opts.approvalPolicyId}' — using the settings default`,
        );
      }
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

  /** Pre-session catalog: the approval tiers plus the settings default the session would adopt, so
   * the new-session surface can pick one before any Query exists. Models stay on the static
   * AGENT_MODEL_OPTIONS table — Claude's model list is a fixed vendor set. */
  override async startCatalog(opts: AgentStartCatalogOptions = {}): Promise<AgentStartCatalog> {
    return {
      models: [],
      policies: [...APPROVAL_POLICIES],
      defaultPolicyId:
        (opts.cwd === undefined ? undefined : await settingsDefaultMode(opts.cwd)) ?? 'default',
      ...(await this.settingsDefaults(opts.cwd)),
    };
  }

  /** The model/effort a session would adopt from settings, via the same `resolveSettings` the
   * start path uses — it applies the managed and remote policy tiers a raw settings.json walk
   * would miss. A load failure leaves the axes absent rather than sinking the whole catalog: the
   * approval tiers above are readable without the SDK. */
  private async settingsDefaults(
    cwd: string | undefined,
  ): Promise<{ defaultModel?: string; defaultEffort?: EffortLevel }> {
    try {
      const sdk = await this.loadSdk(
        '@anthropic-ai/claude-agent-sdk',
        () => import('@anthropic-ai/claude-agent-sdk'),
      );
      const { effective } = await sdk.resolveSettings(cwd === undefined ? {} : { cwd });
      const effort = effective.ultracode === true ? 'ultracode' : effective.effortLevel;
      return {
        ...(effective.model !== undefined && { defaultModel: effective.model }),
        ...(effort !== undefined && { defaultEffort: effort }),
      };
    } catch {
      return {};
    }
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }

  override async branchHistory(
    opts: AgentHistoryBranchOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    const predecessor = decodeHistoryBranchCursor(opts.cursor, this.kind, opts.historyId);
    if (predecessor !== null) {
      const mod = await this.loadSdk(
        '@anthropic-ai/claude-agent-sdk',
        () => import('@anthropic-ai/claude-agent-sdk'),
      );
      const fork = await mod.forkSession(opts.historyId, {
        upToMessageId: predecessor,
        dir: startOpts.cwd,
      });
      this.resumeFrom = fork.sessionId;
    }
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
      readSubagentTranscripts(mod, opts.historyId, (agentId) =>
        this.readSubagentPatches(opts.historyId, agentId),
      ),
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
      supplement.toolUsePatches,
      supplement.parentUuidByUuid,
      supplement.toolUses,
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
          for (let i = 0, len = children.length; i < len; i++) {
            const child = children[i];
            pushWithSubagents(child);
          }
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
    const rows = [...dropped, ...page];
    for (let i = 0, len = rows.length; i < len; i++) {
      const message = rows[i];
      const mapped = mapper(message);
      for (let j = 0, eventCount = mapped.length; j < eventCount; j++) {
        pushWithSubagents(mapped[j]);
      }
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

  /** Test seam over the per-subagent transcript probe (see `readSubagentPatches`). */
  protected readSubagentPatches(
    sessionId: string,
    agentId: string,
  ): Promise<ReadonlyMap<string, ToolCallContent[]>> {
    return readSubagentPatches(sessionId, agentId);
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    this.freshSegment();
    interface ClaudeImageBlock {
      type: 'image';
      source: { type: 'base64'; media_type: SupportedAttachmentImageMimeType; data: string };
    }
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
    const processEnvironment = nullthrow(
      this.processEnvironment,
      'claude-code: project environment not loaded',
    );
    const credentialEnv =
      claudeCodeEnv(processEnvironment, readAgentCredential(opts.config)) ?? processEnvironment;
    const configuredMcpServers = claudeMcpServers(opts.mcpServers);
    if (this.browserTools && configuredMcpServers?.linkcode_browser) {
      throw new Error(
        "claude-code: MCP server name 'linkcode_browser' is reserved for browser tools",
      );
    }
    const browserMcpServer = this.browserTools ? await this.buildBrowserMcpServer() : undefined;
    const mcpServers =
      configuredMcpServers || browserMcpServer
        ? { ...configuredMcpServers, ...browserMcpServer }
        : undefined;
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
        // Only `max` here — it pins the level; other levels switch live via applyFlagSettings.
        effort: this.effort === 'max' ? 'max' : undefined,
        includePartialMessages: true,
        forwardSubagentText: true,
        // Raw flag, not options.thinking — the typed option would also pin --thinking adaptive.
        extraArgs: { 'thinking-display': 'summarized' },
        // Read-only Stop hook reflecting the resolved effort (see `reflectEffortHook`).
        hooks: { Stop: [{ hooks: [reflectCurrentQueryEffort] }] },
        canUseTool: this.canUseTool,
        permissionMode: this.approvalPolicy,
        // Gate for later live switch to bypassPermissions; must be set at startup.
        allowDangerouslySkipPermissions: true,
        resume,
        additionalDirectories: opts.additionalDirectories,
        ...(mcpServers && { mcpServers }),
        env: credentialEnv,
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
    this.titlePollController?.abort();
    this.titlePollController = null;
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

  /** A compaction's summary frame never outlives its turn — drop a stale boundary stash so the
   * summary match can't fire against an unrelated later frame. */
  protected override teardown(): void {
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
    const toolCallId = options.toolUseID;
    const title = options.title ?? toolName;
    this.emitTool({
      toolCallId,
      title,
      kind: claudeToolKind(toolName),
      status: 'in_progress',
      rawInput: input,
      locations: hostLocationsFromToolInput(input),
    });
    const outcome = await this.requestPermission(
      {
        title,
        subject: { type: 'tool-call', toolCallId },
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
    for (let i = 0, len = questions.length; i < len; i++) {
      const qi = i,
        question = questions[i];
      const answer = byQuestionId.get(`q${qi}`);
      if (!answer) continue;
      const selected = new Set(answer.selectedOptionIds);
      const labels: string[] = [];
      for (let j = 0, optionCount = question.options.length; j < optionCount; j++) {
        const oi = j;
        const option = question.options[j];
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
        this.handleStreamEvent(msg);
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
    const reason = msg.decision_reason ?? msg.message;
    if (reason) {
      this.appendToolContent(msg.tool_use_id, { type: 'content', content: textBlock(reason) });
    }
    this.emitTool({
      toolCallId: msg.tool_use_id,
      title: msg.tool_name,
      kind: claudeToolKind(msg.tool_name),
      status: 'failed',
    });
  }

  private handleStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>): void {
    // Subagent narration renders message-level from the forwarded assistant frames
    // (handleSubagentAssistant); consuming its deltas here would render the same text twice.
    if (msg.parent_tool_use_id) return;
    const event = msg.event;
    if (event.type === 'message_start') {
      this.messageId = asMessageId(event.message.id);
      this.thoughtId = asMessageId(`${event.message.id}:think`);
      return;
    }
    if (event.type !== 'content_block_delta') return;
    const delta = event.delta;
    // message_start's API id is stable across every delta and is persisted inside each transcript
    // row; the SDK envelope uuid is per-frame and cannot group or reconcile streamed chunks.
    if (delta.type === 'text_delta') this.emitAssistantText(delta.text, this.messageId);
    else if (delta.type === 'thinking_delta') this.emitThought(delta.thinking, this.thoughtId);
  }

  private handleAssistant(msg: AssistantSDKMessage): void {
    if (msg.parent_tool_use_id) {
      this.handleSubagentAssistant(msg.message, msg.parent_tool_use_id);
      return;
    }
    const message = msg.message;
    // Every assistant frame carries the served model — the source of truth for a mid-session switch
    // (`init` fires only at Query creation, so it can't catch a live `setModel`).
    this.syncModel(message.model);
    let calledTool = false;
    for (let i = 0, len = message.content.length; i < len; i++) {
      const block = message.content[i];
      if (block.type === 'tool_use') {
        const content = toolInputContent(block.name, block.input);
        // Announce the tool the moment Claude requests it; the matching tool_result settles it.
        this.emitTool({
          toolCallId: block.id,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content,
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
   * id; text/thinking render message-level under the provider message id (which the history mapper
   * also reads from the transcript row). It never touches the main message/thought
   * cursors or calls `freshSegment()`, so a mid-turn subagent can't break the main streaming bubble.
   */
  private handleSubagentAssistant(message: AssistantMessage, parent: string): void {
    for (let i = 0, len = message.content.length; i < len; i++) {
      const block = message.content[i];
      // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (other block variants are ignored); the switch autofix then trips the error-level default-case rule
      if (block.type === 'tool_use') {
        const content = toolInputContent(block.name, block.input);
        this.emitTool({
          toolCallId: block.id,
          parentToolCallId: parent,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content,
          rawInput: block.input,
          locations: hostLocationsFromToolInput(block.input),
        });
      } else if (block.type === 'text') {
        this.emitAssistantText(block.text, asMessageId(message.id), parent);
      } else if (block.type === 'thinking') {
        this.emitThought(block.thinking, asMessageId(`${message.id}:think`), parent);
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
    const patched = results.length === 1 ? editResultDiffContent(msg.tool_use_result) : undefined;
    for (let i = 0, len = content.length; i < len; i++) {
      const block = content[i];
      if (block.type !== 'tool_result') continue;
      // Replace (not append) so the patch-bearing diff supersedes the announce-time fragment
      // instead of stacking a second card, and do it before the settle below: a completed tool is
      // terminal, so any content emitted after it is silently dropped.
      if (patched) this.emitTool({ toolCallId: block.tool_use_id, content: patched });
      const resultContent = toolResultContent(block.content);
      for (let j = 0, resultCount = resultContent.length; j < resultCount; j++) {
        this.appendToolContent(block.tool_use_id, resultContent[j]);
      }
      this.emitTool({
        toolCallId: block.tool_use_id,
        // Re-stated on settle so the parent link survives even if the announce was never seen
        // (e.g. it sat beyond a history read's page window). Null for main-agent results.
        parentToolCallId: msg.parent_tool_use_id ?? undefined,
        status: block.is_error === true ? 'failed' : 'completed',
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
    if (
      msg.subtype === 'success' &&
      this.emitGatewayError({
        statusCode: msg.api_error_status,
      })
    ) {
      this.teardown();
      if (!cancelling) this.emitStatus('idle');
      return;
    }
    if (msg.subtype === 'success' && msg.api_error_status === 401) {
      this.emitError(
        'Claude authentication failed — sign in to Claude',
        AUTH_FAILED_ERROR_CODE,
        false,
      );
      this.teardown();
      if (!cancelling) this.emitStatus('idle');
      return;
    }
    if (!cancelling) {
      if (this.titlePollStarted) {
        if (msg.subtype === 'success') this.refreshTitle();
      } else {
        this.startTitlePoll();
      }
    }
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
    } else if (cancelling) {
      // This non-success result is the fallout of our own onCancel()'s interrupt(), not a real
      // failure — consume the flag instead of surfacing it as an error.
    } else {
      const message = claudeResultErrorMessage(msg);
      this.emitProviderError(message, { message });
    }
    this.teardown();
    // A result can beat interrupt()'s control ack. Keep the gate closed until onCancel returns so
    // base send(cancel)'s final teardown cannot sweep a newly admitted turn.
    if (!cancelling) this.emitStatus('idle');
  }

  private startTitlePoll(): void {
    const sessionId = this.lastSessionRef;
    const getSessionInfo = this.getSessionInfo;
    if (!sessionId || !getSessionInfo || this.titlePollStarted) return;
    this.titlePollStarted = true;
    const controller = new AbortController();
    this.titlePollController = controller;
    void this.pollTitle(sessionId, getSessionInfo, controller.signal).finally(() => {
      if (this.titlePollController === controller) this.titlePollController = null;
    });
  }

  private refreshTitle(): void {
    const sessionId = this.lastSessionRef;
    const getSessionInfo = this.getSessionInfo;
    if (!sessionId || !getSessionInfo) return;
    this.titlePollController?.abort();
    const controller = new AbortController();
    this.titlePollController = controller;
    void (async () => {
      if (!(await this.readAndEmitTitle(sessionId, getSessionInfo, controller.signal))) {
        await this.pollTitle(sessionId, getSessionInfo, controller.signal);
      }
    })().finally(() => {
      if (this.titlePollController === controller) this.titlePollController = null;
    });
  }

  private async pollTitle(
    sessionId: string,
    getSessionInfo: (
      sessionId: string,
      options?: { dir?: string },
    ) => Promise<SDKSessionInfo | undefined>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await waitWithAbort(TITLE_POLL_INITIAL_DELAY_MS, signal, true);
      await asyncRetry(
        async () => {
          if (await this.readAndEmitTitle(sessionId, getSessionInfo, signal)) return;
          throw new Error('Claude session title is not available');
        },
        {
          retries: TITLE_POLL_RETRIES,
          factor: 2,
          minTimeout: TITLE_POLL_RETRY_DELAY_MS,
          randomize: false,
          signal,
        },
      );
    } catch {
      // Metadata is best-effort; polling exhaustion or cancellation must not affect the session.
    }
  }

  private async readAndEmitTitle(
    sessionId: string,
    getSessionInfo: (
      sessionId: string,
      options?: { dir?: string },
    ) => Promise<SDKSessionInfo | undefined>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const info = await getSessionInfo(sessionId, { dir: this.opts?.cwd });
      if (signal.aborted || this.stopped || this.lastSessionRef !== sessionId) return false;
      const title = generatedClaudeTitle(info);
      if (!title) return false;
      this.emitTitle(title);
      return true;
    } catch {
      return false;
    }
  }
}

function generatedClaudeTitle(info: SDKSessionInfo | undefined): string | undefined {
  // The SDK folds explicit and AI titles into customTitle; summary can fall back to the last prompt.
  return info ? firstText(info.customTitle) : undefined;
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
    return [{ type: 'diff', change: 'modify', path: toHostPath(path), oldText, newText }];
  }
  if (toolName === 'Write') {
    const { file_path: path, content: newText } = input;
    if (typeof path !== 'string' || typeof newText !== 'string') return undefined;
    return [{ type: 'diff', change: 'add', path: toHostPath(path), newText }];
  }
  return undefined;
}

function toolInputContent(toolName: string, input: unknown): ToolCallContent[] | undefined {
  const diff = editDiffContent(toolName, input);
  if (diff || toolName !== 'WebFetch' || !isRecord(input) || typeof input.url !== 'string') {
    return diff;
  }
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return [
      {
        type: 'content',
        content: { type: 'resource_link', uri: url.href, name: url.hostname },
      },
    ];
  } catch {
    return undefined;
  }
}

function isUnifiedDiffHunk(value: unknown): value is UnifiedDiffHunk {
  return (
    isRecord(value) &&
    typeof value.oldStart === 'number' &&
    typeof value.oldLines === 'number' &&
    typeof value.newStart === 'number' &&
    typeof value.newLines === 'number' &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => typeof line === 'string')
  );
}

/**
 * Upgrade an Edit's announce-time diff with the patch the settle frame carries. `editDiffContent`
 * only sees the tool INPUT — `old_string`/`new_string`, the replaced region with no line numbers and
 * no surrounding rows — while `tool_use_result.structuredPatch` carries real hunk offsets and three
 * context lines a side, which is what the UI needs to place an edit in its file (CODE-399).
 *
 * `structuredPatch` is the only usable source: over real transcripts `gitDiff` is never populated
 * and `originalFile` is frequently null. Write is excluded deliberately — its dominant `create` case
 * ships an EMPTY `structuredPatch`, and whole-file `newText` already beats an all-`+` patch.
 *
 * Duck-typed throughout: `tool_use_result` is `unknown` on the SDK's user frame, so `FileEditOutput`
 * is documentation rather than a runtime guarantee. The `oldString`/`newString` pair is also what
 * distinguishes an Edit result from a Write one, since the settle frame carries no tool name.
 */
export function editResultDiffContent(value: unknown): ToolCallContent[] | undefined {
  if (!isRecord(value)) return undefined;
  const { filePath, oldString: oldText, newString: newText, structuredPatch } = value;
  if (typeof filePath !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
    return undefined;
  }
  if (!Array.isArray(structuredPatch)) return undefined;
  const hunks = structuredPatch.filter(isUnifiedDiffHunk);
  if (hunks.length === 0) return undefined;
  return [
    {
      type: 'diff',
      change: 'modify',
      path: toHostPath(filePath),
      oldText,
      newText,
      patch: { format: 'git_patch', text: unifiedPatchText(hunks) },
    },
  ];
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
  const valueEntries = Object.entries(value);
  for (let i = 0, len = valueEntries.length; i < len; i++) {
    const [key, field] = valueEntries[i];
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
  /** Message uuid → raw transcript predecessor. The SDK projection strips `parentUuid`, but Claude
   * requires the predecessor message id when forking immediately before a historical prompt. */
  parentUuidByUuid: Map<string, string | null>;
  /** tool_use_id → announce snapshot. Cursor pages can begin at the matching result row, after
   * the stateful mapper's in-page announce map has been reset. */
  toolUses: Map<string, ToolCall>;
  /** tool_use_id → projected `toolUseResult` envelope (`toolUseResultEnvelope`), another field
   * `getSessionMessages` strips per row. Keyed only for unambiguous single-result rows. */
  toolUseResults: Map<string, Record<string, unknown>>;
  /** tool_use_id → the Edit diff recovered from the same raw `toolUseResult`. Separate from
   * `toolUseResults` because the envelope keeps scalars only, so its filter drops `structuredPatch`
   * (an array) by construction. Keyed on the same single-result rows. */
  toolUsePatches: Map<string, ToolCallContent[]>;
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
  const parentUuidByUuid = new Map<string, string | null>();
  const toolUses = new Map<string, ToolCall>();
  const toolUseResults = new Map<string, Record<string, unknown>>();
  const toolUsePatches = new Map<string, ToolCallContent[]>();
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
    parentUuidByUuid.set(uuid, typeof row.parentUuid === 'string' ? row.parentUuid : null);
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
    // Result fields are harvested before the exclusions: tool_use ids are globally unique, so
    // keying a result row the timeline itself skips is harmless.
    if (row.type === 'user') harvestToolUseResult(toolUseResults, toolUsePatches, row);
    // Same exclusions as the SDK's own reader: meta rows, sidechains, and teammate rows.
    if (row.isMeta === true || row.isSidechain === true || row.teamName) continue;
    if (row.type === 'assistant') harvestToolUses(toolUses, row);
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
    parentUuidByUuid,
    // Only rows before the last boundary are dropped by the SDK's chain walk; the rest of the
    // timeline (summary head onward) comes back from getSessionMessages as usual.
    droppedRows: rows.reduce<SessionMessage[]>((dropped, r) => {
      if (r.boundariesBefore < boundaries) dropped.push(r.row);
      return dropped;
    }, []),
    toolUses,
    toolUseResults,
    toolUsePatches,
  };
}

function harvestToolUses(toolUses: Map<string, ToolCall>, row: Record<string, unknown>): void {
  const parentToolCallId = stringField(row, 'parent_tool_use_id');
  const blocks = messageContentBlocks(row.message);
  for (let i = 0, len = blocks.length; i < len; i++) {
    const block = blocks[i];
    if (isToolUseBlock(block)) {
      toolUses.set(block.id, claudeToolCallFromUse(block, parentToolCallId));
    }
  }
}

/** Key a raw result row's `toolUseResult` projections by its tool_use id. The field is row-level, so
 * only a row with exactly one tool_result block pairs unambiguously. The envelope and the Edit patch
 * are independent projections of that one field — either can be absent. */
function harvestToolUseResult(
  envelopes: Map<string, Record<string, unknown>>,
  patches: Map<string, ToolCallContent[]>,
  row: Record<string, unknown>,
): void {
  const envelope = toolUseResultEnvelope(row.toolUseResult);
  const patch = editResultDiffContent(row.toolUseResult);
  if (!envelope && !patch) return;
  const message = isRecord(row.message) ? row.message : undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return;
  const ids = content.reduce<string[]>((ids, block) => {
    if (isRecord(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      ids.push(block.tool_use_id);
    }
    return ids;
  }, []);
  if (ids.length !== 1) return;
  if (envelope) envelopes.set(ids[0], envelope);
  if (patch) patches.set(ids[0], patch);
}

/**
 * Locate the session's transcript and build its supplement. `readHistory` carries no cwd, so —
 * mirroring `getSessionMessages` without `dir` — every project dir is probed for
 * `<sessionId>.jsonl` (the id is unique, so at most one probe succeeds). Any failure degrades to
 * an empty supplement: history still reads, just without compaction markers or result envelopes.
 */
async function readClaudeProjectText(segments: readonly string[]): Promise<string | null> {
  const projectsDir = path.join(homedir(), '.claude', 'projects');
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return null;
  }
  const texts = await Promise.all(
    dirs.map((dir) => readFile(path.join(projectsDir, dir, ...segments), 'utf8').catch(() => null)),
  );
  return texts.find((t) => t !== null) ?? null;
}

async function readClaudeTranscriptSupplement(
  sessionId: string,
): Promise<ClaudeTranscriptSupplement> {
  // The id becomes a filename — refuse anything that could traverse out of the projects dir.
  if (!SAFE_SESSION_ID.test(sessionId)) return EMPTY_SUPPLEMENT;
  const text = await readClaudeProjectText([`${sessionId}.jsonl`]);
  return text ? buildClaudeTranscriptSupplement(text.split('\n')) : EMPTY_SUPPLEMENT;
}

/**
 * A subagent's own `subagents/agent-{id}.jsonl`, read for the same reason the parent transcript is:
 * the SDK's `getSubagentMessages` projection strips `toolUseResult`, so a replayed subagent Edit
 * would fall back to the announce-time fragment while the live one carries real hunks.
 *
 * Caveat worth knowing before trusting this: across the local corpus (117 subagent transcripts) the
 * CLI writes `toolUseResult` as a bare error string only — never the structured `FileEditOutput` —
 * and the one real subagent Edit had no `toolUseResult` on its settle row in either transcript. So
 * this recovers nothing on today's CLI; it removes the asymmetry with the parent path and starts
 * working the moment the CLI persists the field.
 */
async function readSubagentPatches(
  sessionId: string,
  agentId: string,
): Promise<ReadonlyMap<string, ToolCallContent[]>> {
  // Both ids become path segments.
  if (!SAFE_SESSION_ID.test(sessionId) || !SAFE_SESSION_ID.test(agentId)) return new Map();
  const text = await readClaudeProjectText([sessionId, 'subagents', `agent-${agentId}.jsonl`]);
  return text ? buildClaudeTranscriptSupplement(text.split('\n')).toolUsePatches : new Map();
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
  patchesFor: (agentId: string) => Promise<ReadonlyMap<string, ToolCallContent[]>>,
): Promise<Map<string, AgentHistoryEvent[]>> {
  const agentIds = await mod.listSubagents(sessionId);
  const byParent = new Map<string, AgentHistoryEvent[]>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const [rows, patches] = await Promise.all([
        mod.getSubagentMessages(sessionId, agentId, { limit: 1000 }),
        patchesFor(agentId),
      ]);
      const parent = rows.find((row) => row.parent_tool_use_id !== null)?.parent_tool_use_id;
      if (!parent) return;
      byParent.set(
        parent,
        rows.flatMap(
          // No compaction records or result envelopes: a subagent transcript has no compaction
          // boundary, and `rawOutput` recovery there is a separate concern.
          createClaudeHistoryEventMapper(
            asHistoryId(sessionId),
            undefined,
            undefined,
            patches,
            undefined,
          ),
        ),
      );
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
  /** Edit diffs recovered from the same raw results, so a replayed settle carries the patch the
   * live path emits rather than the announce-time fragment. */
  toolUsePatches?: ReadonlyMap<string, ToolCallContent[]>,
  /** Raw message ancestry recovered from the transcript; absent for nested subagent reads. */
  parentUuidByUuid?: ReadonlyMap<string, string | null>,
  /** Announce snapshots recovered from the raw transcript, for cursor pages starting at settle. */
  toolUses?: ReadonlyMap<string, ToolCall>,
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
      const providerMessageId = isRecord(message.message)
        ? stringField(message.message, 'id')
        : undefined;
      const messageId = providerMessageId ?? message.uuid;
      // Every assistant row records the model that served it; replay it as the same model-update
      // the live stream emits so seeded messages get their per-turn model stamp. Subagent rows
      // are skipped — their model must not masquerade as the session's.
      const model =
        !parent && isRecord(message.message) ? stringField(message.message, 'model') : undefined;
      if (model && model !== lastModel) {
        lastModel = model;
        events.push({ historyId, ts, event: { type: 'model-update', model } });
      }
      for (let i = 0, len = blocks.length; i < len; i++) {
        const block = blocks[i];
        if (!isThinkingBlock(block)) continue;
        const thought = thoughtHistoryEvent(
          historyId,
          `${messageId}:think`,
          block.thinking,
          ts,
          parent,
        );
        if (thought) events.push(thought);
      }
      const text = textHistoryEvent(historyId, 'assistant', messageId, message.message, ts, parent);
      if (text) events.push(text);
      for (let i = 0, len = blocks.length; i < len; i++) {
        const block = blocks[i];
        if (!isToolUseBlock(block)) continue;
        events.push(toolEvent(claudeToolCallFromUse(block, parent)));
      }
      return events;
    }

    const results = blocks.filter((block) => isToolResultBlock(block));
    for (let i = 0, len = results.length; i < len; i++) {
      const block = results[i];
      const existing = announced.get(block.tool_use_id) ?? toolUses?.get(block.tool_use_id);
      events.push(
        toolEvent({
          toolCallId: block.tool_use_id,
          parentToolCallId: parent ?? existing?.parentToolCallId,
          // The announce can sit beyond this read's page window; fall back to emitTool's
          // first-sight defaults rather than dropping the settle.
          title: existing?.title ?? block.tool_use_id,
          kind: existing?.kind ?? 'other',
          status: block.is_error === true ? 'failed' : 'completed',
          // A recovered patch supersedes the announce-time input fragment (the live path replaces
          // it too); otherwise the announce content — the Edit diff, or empty — leads the result
          // text.
          content: [
            ...(toolUsePatches?.get(block.tool_use_id) ?? existing?.content ?? []),
            ...toolResultContent(block.content),
          ],
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
    if (text) {
      const predecessor = parentUuidByUuid?.get(message.uuid);
      if (predecessor !== undefined && text.event.type === 'user-message') {
        text.event.branchCursor = encodeHistoryBranchCursor('claude-code', historyId, predecessor);
      }
      events.push(text);
    }
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

function claudeToolCallFromUse(block: ClaudeToolUseBlock, parentToolCallId?: string): ToolCall {
  return {
    toolCallId: block.id,
    parentToolCallId,
    title: block.name,
    kind: claudeToolKind(block.name),
    status: 'in_progress',
    content: toolInputContent(block.name, block.input) ?? [],
    rawInput: block.input,
  };
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
