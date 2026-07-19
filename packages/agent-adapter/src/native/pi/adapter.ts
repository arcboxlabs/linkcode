import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  ExtensionAPI,
  PromptOptions,
  ResourceLoader,
  SessionManager,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentCommand,
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentModelOption,
  AgentStartCatalog,
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  StartOptions,
  StopReason,
  ToolKind,
} from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
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
import { customProviderRegistration, readCustomProvider } from './custom-provider';
import {
  findPiSessionFile,
  importPiSdk,
  lastPiModelChange,
  listPiHistory,
  piAgentDir,
  readPiHistory,
} from './history';
import { piLocalProviders } from './local-providers';
import { createPiUiContext } from './ui-bridge';

type PiModel = NonNullable<CreateAgentSessionOptions['model']>;
type PiModelRegistry = NonNullable<CreateAgentSessionOptions['modelRegistry']>;

/** The EffortLevel ∩ pi ThinkingLevel intersection: pi's 'off'/'minimal' have no EffortLevel
 * representation, and 'max'/'ultracode' are claude-only concepts pi rejects. */
type PiEffort = 'low' | 'medium' | 'high' | 'xhigh';
const PI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly PiEffort[];
const PI_EFFORTS = new Set<string>(PI_EFFORT_LEVELS);

function isPiEffort(effort: string): effort is PiEffort {
  return PI_EFFORTS.has(effort);
}

function effortFromThinkingLevel(level: string): PiEffort | null {
  return isPiEffort(level) ? level : null;
}

function parsePiModelRef(ref: string): { provider: string; modelId: string } | null {
  const [provider, ...rest] = ref.split('/');
  const modelId = rest.join('/');
  return provider && modelId ? { provider, modelId } : null;
}

/** Mirror of pi-ai's `getSupportedThinkingLevels` over our EffortLevel subset: a level explicitly
 * nulled in `thinkingLevelMap` is unsupported, and `xhigh` counts only when explicitly mapped —
 * a reasoning model with no map therefore caps at `high` (verified in pi-ai models.js:207-218). */
function piEffortLevels(model: PiModel): PiEffort[] {
  if (!model.reasoning) return [];
  return PI_EFFORT_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh') return mapped !== undefined;
    return true;
  });
}

function piModelOptions(models: readonly PiModel[]): AgentModelOption[] {
  return models.map((m) => ({
    id: `${m.provider}/${m.id}`,
    label: m.name ?? m.id,
    description: `${m.provider}/${m.id}`,
    effortLevels: piEffortLevels(m),
  }));
}

/** The `/` catalog pi's own prompt expansion understands: prompt templates by name, skills as
 * `skill:<name>` (the SDK's registered command form). `disable-model-invocation` skills stay
 * listed — hiding a skill from the model is exactly what makes it user-invoke-only. Extension
 * commands are excluded: they run through `ExtensionCommandContext`, not prompt expansion. */
export function piCommandCatalog(
  loader: Pick<ResourceLoader, 'getSkills' | 'getPrompts'>,
): AgentCommand[] {
  const { prompts } = loader.getPrompts();
  const { skills } = loader.getSkills();
  return [
    ...prompts.map(
      (p): AgentCommand => ({
        name: p.name,
        description: p.description || undefined,
        argumentHint: p.argumentHint,
      }),
    ),
    ...skills.map((s): AgentCommand => ({ name: `skill:${s.name}`, description: s.description })),
  ];
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

  override readonly capabilities = { slashCommands: true, shellCommand: false } as const;

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
   * and scoped to one provider, so live model switches must stay inside it (opencode parity) or
   * inside {@link locallyAuthedProviders}, whose auth does not depend on the injection. */
  private credentialProviderId: string | null = null;
  /** Providers usable WITHOUT the injected credential (models.json inline keys, auth.json
   * logins), snapshotted before injection: credential scoping must not hide or reject them. */
  private locallyAuthedProviders: ReadonlySet<string> = new Set();

  override async startCatalog(_opts: { cwd?: string }): Promise<AgentStartCatalog> {
    // Plain import on a never-started instance (the history precedent). The catalog reflects the
    // machine's own auth: an account credential only lands at start(), so its provider's models
    // appear pre-session only when local auth also covers them.
    const pi = await importPiSdk();
    const registry = pi.ModelRegistry.create(pi.AuthStorage.create());
    const localProviders = piLocalProviders(pi, registry);
    return {
      models: piModelOptions(registry.getAvailable()),
      policies: [...APPROVAL_POLICIES],
      defaultPolicyId: INITIAL_POLICY_ID,
      ...(localProviders.length > 0 && { localProviders }),
    };
  }

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
    const pi = await this.loadSdk('@earendil-works/pi-coding-agent', importPiSdk);
    // Initial picks from the new-session surface; invalid values degrade with an error event
    // rather than failing session creation (same posture as a stale explicit model below).
    if (opts.approvalPolicyId) {
      if (isPiPolicyId(opts.approvalPolicyId)) this.policyId = opts.approvalPolicyId;
      else this.emitError(`pi: unknown approval policy '${opts.approvalPolicyId}' — using default`);
    }
    let initialThinking: PiEffort | undefined;
    if (opts.effort) {
      if (isPiEffort(opts.effort)) initialThinking = opts.effort;
      else this.emitError(`pi: effort '${opts.effort}' is not supported (low–xhigh only)`);
    }
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
      savedProvider = lastPiModelChange(sessionManager.getBranch())?.provider;
    }

    // The explicit ref is parsed from the STRING before any registry lookup: the provider prefix
    // must be known before credential injection, and the registry's availability view
    // (getAvailable) is auth-gated — a fresh account whose only auth is the injected credential
    // has nothing "available" until the injection below lands.
    const explicitRef = opts.model ? parsePiModelRef(opts.model) : null;
    if (opts.model && !explicitRef) {
      throw new Error(`pi: model must be 'provider/modelId' (got '${opts.model}')`);
    }

    this.locallyAuthedProviders = new Set(modelRegistry.getAvailable().map((m) => m.provider));

    // Pi resolves auth through AuthStorage; inject the account's key as a runtime override for the
    // session's provider so it takes precedence over ~/.pi/agent/auth.json and env vars. A
    // gateway account's base URL is registered on the model registry (it overrides the provider's
    // URL) — except onto a models.json local provider, which owns its endpoint: the account may
    // override its key, but replacing its base URL would corrupt the routing whenever the bound
    // account actually belongs to another provider. An account that DEFINES its provider
    // (customProvider) names the injection target itself and registers with its full model list.
    const custom = readCustomProvider(opts.config);
    const cred = readAgentCredential(opts.config);
    const key = cred.apiKey ?? cred.authToken;
    const provider =
      custom?.name ??
      explicitRef?.provider ??
      savedProvider ??
      modelRegistry.getAvailable()[0]?.provider;
    if (provider && (key || cred.baseUrl)) {
      if (key) authStorage.setRuntimeApiKey(provider, key);
      if (custom) {
        const registration = customProviderRegistration(custom, opts.config, key, cred.baseUrl);
        if (registration) {
          try {
            modelRegistry.registerProvider(provider, registration);
          } catch (err) {
            // A rejected definition degrades (models unavailable) instead of failing the session,
            // matching the stale-model posture below.
            this.emitError(
              `pi: custom provider '${provider}' was rejected — ${extractErrorMessage(err)}`,
            );
          }
        } else {
          this.emitError(
            `pi: custom provider '${provider}' needs an endpoint URL, a key, and a protocol — its models are unavailable`,
          );
        }
      } else if (
        cred.baseUrl &&
        !piLocalProviders(pi, modelRegistry).some((p) => p.id === provider)
      ) {
        modelRegistry.registerProvider(provider, {
          baseUrl: cred.baseUrl,
          ...(key && { apiKey: key }),
        });
      }
      this.credentialProviderId = provider;
    }
    this.modelRegistry = modelRegistry;

    // Model pick, resolved AFTER injection so a credential-only account sees its provider's
    // models. A resumed session leaves `model` unset so the SDK's own restore path wins. An
    // explicit ref that no longer resolves (a stale persisted default, a retired model) degrades
    // — to the provider's first available model fresh, to the SDK-restored saved model on resume
    // — rather than killing session creation.
    let model: PiModel | undefined;
    if (explicitRef) {
      model = modelRegistry.find(explicitRef.provider, explicitRef.modelId);
      if (!model) {
        this.emitError(
          `pi: model '${opts.model}' is not available — using the ${this.resumeFrom ? "session's saved" : 'default'} model`,
        );
        if (!this.resumeFrom) {
          model = modelRegistry.getAvailable().find((m) => m.provider === explicitRef.provider);
        }
      }
    }
    if (!model && !this.resumeFrom) {
      // An account-defined provider is the session's reason for being — default inside it.
      model = custom
        ? (modelRegistry.getAvailable().find((m) => m.provider === custom.name) ??
          modelRegistry.getAvailable()[0])
        : modelRegistry.getAvailable()[0];
    }

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
      // An explicit initial pick overrides both the settings default and a resume's restore;
      // the SDK clamps it to the model's supported levels.
      ...(initialThinking && { thinkingLevel: initialThinking }),
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
        ask: (toolCall, questions, signal) => this.requestQuestion(toolCall, questions, signal),
        reportError: (message) => this.emitError(`pi: ${message}`, 'extension-error'),
      }),
      mode: 'rpc',
      onError: (err) =>
        this.emitError(
          `pi: extension error (${err.extensionPath}): ${err.error}`,
          'extension-error',
        ),
    });
    // Snapshot catalog (opencode precedent — no change events; `/reload` is TUI-only). Absence
    // is itself the no-menu signal, so an empty discovery emits nothing.
    const commands = piCommandCatalog(resourceLoader);
    if (commands.length > 0) this.emitCommands(commands);
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
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
    await this.runPrompt(contentToText(content), imageOptions);
  }

  /** Slash commands ride the normal prompt path: pi's `session.prompt` expands `/skill:name` and
   * `/template` text itself before sending, so an invocation is plain text with a leading slash
   * and settles through the same agent_end lifecycle as any prompt. */
  protected override async onCommand(name: string, args?: string): Promise<void> {
    await this.runPrompt(`/${name}${args ? ` ${args}` : ''}`);
  }

  private async runPrompt(text: string, options?: Pick<PromptOptions, 'images'>): Promise<void> {
    invariant(this.session, 'pi: session not started');
    this.emitStatus('running');
    try {
      if (this.session.isStreaming) {
        await this.session.prompt(text, { ...options, streamingBehavior: 'followUp' });
      } else await this.session.prompt(text, options);
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
    const ref = parsePiModelRef(model);
    if (!ref) {
      throw new Error(`pi: model must be 'provider/modelId' (got '${model}')`);
    }
    if (
      this.credentialProviderId &&
      ref.provider !== this.credentialProviderId &&
      !this.locallyAuthedProviders.has(ref.provider)
    ) {
      throw new Error(
        `pi: this session's credential is scoped to '${this.credentialProviderId}' — start a new session to use provider '${ref.provider}'`,
      );
    }
    const found = modelRegistry.find(ref.provider, ref.modelId);
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
      ? registry
          .getAvailable()
          .filter(
            (m) =>
              m.provider === this.credentialProviderId ||
              this.locallyAuthedProviders.has(m.provider),
          )
      : registry.getAvailable();
    if (models.length === 0) return;
    this.emitModels(piModelOptions(models));
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
