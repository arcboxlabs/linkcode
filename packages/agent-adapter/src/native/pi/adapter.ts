import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  ExtensionAPI,
  PromptOptions,
  SessionManager,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  StartOptions,
  StopReason,
  ToolKind,
} from '@linkcode/schema';
import { invariant } from 'foxts/guard';
import { BaseAgentAdapter } from '../../base';
import { readAgentCredential } from '../../credential';
import { asHistoryId } from '../../history-util';
import {
  contentToText,
  imageBlocksFrom,
  locationsFromToolInput,
  toolKindFromName,
} from '../../util';
import {
  findPiSessionFile,
  importPiSdk,
  lastPiModelChange,
  listPiHistory,
  piAgentDir,
  readPiHistory,
} from './history';
import { createPiUiContext } from './ui-bridge';

type PiModel = NonNullable<CreateAgentSessionOptions['model']>;
type PiModelRegistry = NonNullable<CreateAgentSessionOptions['modelRegistry']>;

/** The EffortLevel ∩ pi ThinkingLevel intersection: pi's 'off'/'minimal' have no EffortLevel
 * representation, and 'max'/'ultracode' are claude-only concepts pi rejects. */
type PiEffort = 'low' | 'medium' | 'high' | 'xhigh';
const PI_EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh'] satisfies PiEffort[]);

function isPiEffort(effort: string): effort is PiEffort {
  return PI_EFFORTS.has(effort);
}

function effortFromThinkingLevel(level: string): PiEffort | null {
  return isPiEffort(level) ? level : null;
}

/**
 * The approval-policy axis pi advertises — the shared tier ids mapped onto an adapter-local
 * `tool_call` gate (pi itself has no approval concept: its vendor behavior runs every tool,
 * unsandboxed, without asking). Advertising `default` as the initial tier is a DELIBERATE
 * behavior change from that vendor posture: pi is the only agent of the four that would
 * otherwise mutate the host with zero gates.
 */
const APPROVAL_POLICIES = [
  {
    policyId: 'default',
    name: 'Ask permissions',
    description: 'Ask before edits, commands, and unrecognized tools.',
  },
  {
    policyId: 'acceptEdits',
    name: 'Accept edits',
    description: 'Apply file edits without asking; still ask for commands and unrecognized tools.',
  },
  {
    policyId: 'bypassPermissions',
    name: 'Bypass',
    description: "Run every tool without asking (pi's own default behavior).",
  },
] as const satisfies readonly ApprovalPolicy[];

type PiPolicyId = (typeof APPROVAL_POLICIES)[number]['policyId'];
const INITIAL_POLICY_ID: PiPolicyId = 'default';

/** Tool kinds that run WITHOUT asking under each tier ('bypassPermissions' short-circuits before
 * the lookup). Unknown tools classify as 'other' and therefore always ask below bypass — an
 * extension-registered tool is exactly the thing the user has never seen before. */
const AUTO_KINDS: Record<Exclude<PiPolicyId, 'bypassPermissions'>, ReadonlySet<ToolKind>> = {
  default: new Set<ToolKind>(['read', 'search', 'think']),
  acceptEdits: new Set<ToolKind>(['read', 'search', 'think', 'edit', 'delete', 'move']),
};

function isPiPolicyId(id: string): id is PiPolicyId {
  return APPROVAL_POLICIES.some((policy) => policy.policyId === id);
}

/**
 * Pi adapter — drives `@earendil-works/pi-coding-agent` via `createAgentSession()`. Events arrive through
 * `session.subscribe()`; prompts via `session.prompt()` (queued as a follow-up while streaming). Auth and
 * model selection go through Pi's `AuthStorage` / `ModelRegistry`.
 *
 * Extension dialogs (`ctx.ui.select` / the like) reach the user through `session.bindExtensions` and the
 * headless UI bridge (`ui-bridge.ts`); without that binding the SDK auto-cancels every dialog silently.
 */
export class PiAdapter extends BaseAgentAdapter {
  readonly kind = 'pi' as const;

  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private session: AgentSession | null = null;
  private unsub: (() => void) | null = null;
  /** Set by `resumeHistory` before `start()`; tells `onStart` to continue this session natively. */
  private resumeFrom: AgentHistoryId | null = null;
  /** Current approval tier; the `tool_call` gate reads it per call, so a switch is immediate. */
  private policyId: PiPolicyId = INITIAL_POLICY_ID;
  /** Tool names granted "always allow" for this session (an `allow_always` permission reply). */
  private readonly sessionAllowedTools = new Set<string>();
  private modelRegistry: PiModelRegistry | null = null;
  /** Set when a per-account credential was injected at start — the injection is start-time-only
   * and scoped to one provider, so live model switches must stay inside it (opencode parity). */
  private credentialProviderId: string | null = null;

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    return listPiHistory(await importPiSdk(), opts);
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return readPiHistory(await importPiSdk(), opts);
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }

  protected async onStart(opts: StartOptions): Promise<void> {
    const pi = await this.loadSdk(
      '@earendil-works/pi-coding-agent',
      () => import('@earendil-works/pi-coding-agent'),
    );
    const authStorage = pi.AuthStorage.create();
    const modelRegistry = pi.ModelRegistry.create(authStorage);

    // Resume = reopen the on-disk session and hand its manager to the SDK, which restores the
    // saved model/thinking level itself. The saved model is pre-read here anyway because the
    // credential injection below is provider-scoped and must target the model the session will
    // actually run on (the opencode resume precedent).
    let sessionManager: SessionManager | undefined;
    let savedProvider: string | undefined;
    if (this.resumeFrom) {
      const file = await findPiSessionFile(this.resumeFrom);
      if (!file) throw new Error(`pi: history '${this.resumeFrom}' was not found`);
      sessionManager = pi.SessionManager.open(file);
      savedProvider = lastPiModelChange(
        pi.buildContextEntries(sessionManager.getEntries(), sessionManager.getLeafId()),
      )?.provider;
    }

    // Explicit model pick; a fresh session defaults to the first available, a resumed one leaves
    // `model` unset so the SDK's own restore path wins.
    let model: PiModel | undefined;
    if (opts.model) {
      const [provider, ...rest] = opts.model.split('/');
      if (provider && rest.length > 0) model = modelRegistry.find(provider, rest.join('/'));
    }
    if (!model && !this.resumeFrom) model = modelRegistry.getAvailable()[0];

    // Pi resolves auth through AuthStorage; inject the account's key as a runtime override for the
    // session's provider so it takes precedence over ~/.pi/agent/auth.json and env vars. A
    // gateway account's base URL is registered on the model registry (it overrides the provider's URL).
    const provider = model?.provider ?? savedProvider ?? modelRegistry.getAvailable()[0]?.provider;
    const cred = readAgentCredential(opts.config);
    const key = cred.apiKey ?? cred.authToken;
    if (provider && (key || cred.baseUrl)) {
      if (key) authStorage.setRuntimeApiKey(provider, key);
      if (cred.baseUrl) {
        modelRegistry.registerProvider(provider, {
          baseUrl: cred.baseUrl,
          ...(key && { apiKey: key }),
        });
      }
      this.credentialProviderId = provider;
    }
    this.modelRegistry = modelRegistry;

    // A resumed session runs in its own recorded cwd, not the caller's.
    const cwd = sessionManager?.getCwd() ?? opts.cwd;

    // Supplying our own loader (for the approval-gate inline extension) takes over what
    // createAgentSession would otherwise do itself: default discovery of the user's extensions
    // plus the reload() call — a caller-supplied loader is used as-is, never reloaded (verified
    // in sdk.js).
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: piAgentDir(),
      extensionFactories: [(ext) => this.registerApprovalGate(ext)],
    });
    await resourceLoader.reload();

    const { session, modelFallbackMessage } = await pi.createAgentSession({
      cwd,
      authStorage,
      modelRegistry,
      resourceLoader,
      ...(model && { model }),
      ...(sessionManager && { sessionManager }),
      tools: this.tools(),
    });
    this.session = session;
    this.emitApprovalPolicy(this.approvalPolicyState());
    // Dynamic catalog (CODE-226 contract): pi's model set is whatever the user's auth.json (or
    // the injected credential) unlocks — install-dependent, so the composer gets it from here.
    this.emitModelCatalog(modelRegistry);
    if (session.model) this.emitModel(`${session.model.provider}/${session.model.id}`);
    const effort = effortFromThinkingLevel(session.thinkingLevel);
    if (effort) this.emitEffort(effort);
    if (modelFallbackMessage) this.emitError(`pi: ${modelFallbackMessage}`);
    // A resumed transcript is real, so announcing immediately is safe; fresh sessions defer the
    // announce to the first agent_start (see handleEvent) so a client seed never reads an empty
    // transcript whose cut would swallow the first prompt.
    if (this.resumeFrom) this.emitSessionRef(this.resumeFrom);
    this.unsub = session.subscribe((ev) => this.handleEvent(ev));
    // 'rpc' is pi's own mode id for a headless embedder; extensions read it to skip TUI-only work.
    await session.bindExtensions({
      uiContext: createPiUiContext({
        ask: (toolCall, questions) => this.requestQuestion(toolCall, questions),
        reportError: (message) => this.emitError(`pi: ${message}`, 'extension-error'),
      }),
      mode: 'rpc',
      onError: (err) =>
        this.emitError(
          `pi: extension error (${err.extensionPath}): ${err.error}`,
          'extension-error',
        ),
    });
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    invariant(this.session, 'pi: session not started');
    const text = contentToText(content);
    const images = imageBlocksFrom(content);
    const imageOptions: Pick<PromptOptions, 'images'> | undefined =
      images.length === 0
        ? undefined
        : {
            images: images.map((image) => ({
              type: 'image',
              data: image.data,
              mimeType: image.mimeType,
            })),
          };
    this.emitStatus('running');
    try {
      if (this.session.isStreaming) {
        await this.session.prompt(text, { ...imageOptions, streamingBehavior: 'followUp' });
      } else await this.session.prompt(text, imageOptions);
    } catch (err) {
      // Turn contract (base.ts): a hook that emitted 'running' must emit 'idle' before rejecting,
      // or the engine's input gate never releases. Pi rejects synchronously on preflight failures
      // (no model selected, no API key) without any agent_* lifecycle events.
      this.emitStatus('idle');
      throw err;
    }
  }

  protected override async onSetModel(model: string): Promise<void> {
    const { session, modelRegistry } = this;
    invariant(session, 'pi: session not started');
    invariant(modelRegistry, 'pi: session not started');
    const [provider, ...rest] = model.split('/');
    const modelId = rest.join('/');
    if (!provider || !modelId) {
      throw new Error(`pi: model must be 'provider/modelId' (got '${model}')`);
    }
    if (this.credentialProviderId && provider !== this.credentialProviderId) {
      throw new Error(
        `pi: this session's credential is scoped to '${this.credentialProviderId}' — start a new session to use provider '${provider}'`,
      );
    }
    const found = modelRegistry.find(provider, modelId);
    if (!found) throw new Error(`pi: unknown model '${model}'`);
    // Live switch, applied from the next turn; throws when no auth is configured for the model.
    await session.setModel(found);
    this.emitModel(model);
    // setModel re-clamps the thinking level to the new model's capabilities; reflect the result.
    const effort = effortFromThinkingLevel(session.thinkingLevel);
    if (effort) this.emitEffort(effort);
  }

  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    const { session } = this;
    invariant(session, 'pi: session not started');
    if (!isPiEffort(effort)) {
      return Promise.reject(new Error(`pi: effort '${effort}' is not supported (low–xhigh only)`));
    }
    if (!session.supportsThinking()) {
      return Promise.reject(
        new Error('pi: the current model does not support a reasoning-effort level'),
      );
    }
    // Synchronous live switch; the SDK clamps to the model's supported levels, so reflect the
    // readback rather than the request.
    session.setThinkingLevel(effort);
    const applied = effortFromThinkingLevel(session.thinkingLevel);
    if (applied) this.emitEffort(applied);
    return Promise.resolve();
  }

  protected override onSetApprovalPolicy(policyId: string): Promise<void> {
    if (!isPiPolicyId(policyId)) {
      return Promise.reject(new Error(`pi: unknown approval policy '${policyId}'`));
    }
    this.policyId = policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
    return Promise.resolve();
  }

  protected override async onCancel(): Promise<void> {
    await this.session?.abort();
  }

  protected override onStop(): Promise<void> {
    this.unsub?.();
    this.session?.dispose();
    return Promise.resolve();
  }

  private tools(): string[] | undefined {
    const t = this.opts?.config?.tools;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : undefined;
  }

  private approvalPolicyState(): ApprovalPolicyState {
    return { availablePolicies: [...APPROVAL_POLICIES], currentPolicyId: this.policyId };
  }

  private emitModelCatalog(registry: PiModelRegistry): void {
    const models = this.credentialProviderId
      ? registry.getAvailable().filter((m) => m.provider === this.credentialProviderId)
      : registry.getAvailable();
    if (models.length === 0) return;
    this.emitModels(
      models.map((m) => ({
        id: `${m.provider}/${m.id}`,
        label: m.name ?? m.id,
        description: `${m.provider}/${m.id}`,
      })),
    );
  }

  private registerApprovalGate(ext: ExtensionAPI): void {
    // `beforeToolCall` fires this for every tool before it executes; `{block: true}` turns the
    // call into an error tool-result (`reason` is the text the model sees) without running it.
    ext.on('tool_call', (event) => this.gateToolCall(event));
  }

  private async gateToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
    if (this.policyId === 'bypassPermissions') return undefined;
    const kind = toolKindFromName(event.toolName);
    if (AUTO_KINDS[this.policyId].has(kind)) return undefined;
    if (this.sessionAllowedTools.has(event.toolName)) return undefined;

    // Announce the card before asking so the permission prompt has a tool to point at; on allow,
    // the SDK's own tool_execution_start re-emits the same id and merges into this snapshot.
    const card = {
      toolCallId: event.toolCallId,
      title: event.toolName,
      kind,
      rawInput: event.input,
      locations: locationsFromToolInput(event.input),
    };
    this.emitTool({ ...card, status: 'in_progress' });
    const outcome = await this.requestPermission(card, [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'allow-session', name: 'Always allow this session', kind: 'allow_always' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ]);

    // A cancelled ask means the turn is being torn down — teardown already failed the card.
    if (outcome.outcome === 'cancelled') {
      return { block: true, reason: 'Tool call cancelled by the user' };
    }
    if (outcome.optionId === 'allow-session') {
      this.sessionAllowedTools.add(event.toolName);
      return undefined;
    }
    if (outcome.optionId === 'allow') return undefined;
    this.emitTool({ toolCallId: event.toolCallId, status: 'failed' });
    return { block: true, reason: 'The user declined this tool call' };
  }

  protected handleEvent(ev: AgentSessionEvent): void {
    switch (ev.type) {
      case 'agent_start':
        // Fresh ids at the turn start; a tool boundary later opens the next segment (see below).
        this.freshSegment();
        // First turn running = the transcript now has real entries; `emitSessionRef` dedupes, so
        // later turns are no-ops and a resumed session's earlier announce wins.
        if (this.session) this.emitSessionRef(asHistoryId(this.session.sessionId));
        this.emitStatus('running');
        break;
      case 'agent_end': {
        // An aborted/failed run still ends with agent_end, carrying a final assistant message whose
        // stopReason is 'aborted'/'error' (+ errorMessage) — pi never emits a separate error event.
        const last = ev.messages.at(-1);
        const outcome = last?.role === 'assistant' ? last.stopReason : undefined;
        if (outcome === 'error') {
          const detail = (last?.role === 'assistant' && last.errorMessage) || 'agent run failed';
          this.emitError(`pi: ${detail}`);
          // Failed turn: no stop event, mirroring the opencode failed-turn contract.
        } else {
          this.emitStop(piStopReason(outcome));
        }
        this.emitStatus('idle');
        break;
      }
      case 'message_update': {
        const a = ev.assistantMessageEvent;
        if (a.type === 'text_delta') this.emitAssistantText(a.delta, this.messageId);
        else if (a.type === 'thinking_delta') this.emitThought(a.delta, this.thoughtId);
        break;
      }
      case 'tool_execution_start':
        this.emitTool({
          toolCallId: ev.toolCallId,
          title: ev.toolName,
          kind: toolKindFromName(ev.toolName),
          status: 'in_progress',
          rawInput: ev.args,
          locations: locationsFromToolInput(ev.args),
        });
        // The tool closes the current segment; narration after it groups into a new bubble.
        this.freshSegment();
        break;
      case 'tool_execution_end':
        this.emitTool({
          toolCallId: ev.toolCallId,
          status: ev.isError ? 'failed' : 'completed',
          rawOutput: ev.result,
        });
        break;
      case 'thinking_level_changed': {
        // Covers changes we didn't initiate (an extension, or a clamp after a model switch).
        const effort = effortFromThinkingLevel(ev.level);
        if (effort) this.emitEffort(effort);
        break;
      }
      default:
        break;
    }
  }
}

/** Map pi's assistant stopReason ('stop' | 'length' | 'toolUse' | 'aborted') onto the wire enum. */
function piStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'aborted':
      return 'cancelled';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}
