import { pathToFileURL } from 'node:url';
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
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryReadOptions,
  AgentHistoryResumeOptions,
  AgentStartCatalog,
  ContentBlock,
  EffortLevel,
  StartOptions,
  ToolKind,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { Type } from '@sinclair/typebox';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { invariant } from 'foxts/guard';
import type { AgentStartCatalogOptions, BrowserToolsetFactory } from '../../adapter';
import { renderBrowserToolResult } from '../../adapter';
import { BaseAgentAdapter } from '../../base';
import { readAgentCredential } from '../../credential';
import { decodeHistoryBranchCursor } from '../../history-branch';
import { asHistoryId } from '../../history-util';
import { agentRuntimeProber } from '../../probe';
import {
  contentToText,
  imageBlocksFrom,
  locationsFromToolInput,
  toolKindFromName,
} from '../../util';
import type { PiSdk } from './history';
import {
  findPiSessionFile,
  lastPiModelChange,
  listPiHistory,
  piAgentDir,
  piMessageBlockId,
  readPiHistory,
} from './history';
import { createPiUiContext } from './ui-bridge';

type PiRegistry = NonNullable<CreateAgentSessionOptions['modelRegistry']>;
type PiModel = NonNullable<CreateAgentSessionOptions['model']>;
type PiEffort = 'low' | 'medium' | 'high' | 'xhigh';
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly PiEffort[];
const EFFORTS = new Set<string>(EFFORT_LEVELS);
const POLICIES = [
  {
    policyId: 'default',
    name: 'Ask permissions',
    description: 'Ask before edits, commands, and unrecognized tools.',
  },
  {
    policyId: 'acceptEdits',
    name: 'Accept edits',
    description: 'Apply edits without asking; ask for commands and other tools.',
  },
  { policyId: 'bypassPermissions', name: 'Bypass', description: 'Run every tool without asking.' },
] as const;
type PiPolicy = (typeof POLICIES)[number]['policyId'];
const AUTO: Record<Exclude<PiPolicy, 'bypassPermissions'>, ReadonlySet<ToolKind>> = {
  default: new Set(['read', 'search', 'think']),
  acceptEdits: new Set(['read', 'search', 'think', 'edit', 'delete', 'move']),
};
const isEffort = (value: string): value is PiEffort => EFFORTS.has(value);
function isPolicy(value: string): value is PiPolicy {
  return POLICIES.some((policy) => policy.policyId === value);
}
function parseModel(value: string) {
  const [provider, ...rest] = value.split('/');
  const modelId = rest.join('/');
  return provider && modelId ? { provider, modelId } : null;
}
/** Mirrors pi-ai's supported-level calculation over LinkCode's Pi effort subset. */
function effortLevels(model: PiModel): PiEffort[] {
  if (!model.reasoning) return [];
  return EFFORT_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return level !== 'xhigh' || mapped !== undefined;
  });
}
function modelOptions(models: PiModel[]) {
  return models.map((model) => ({
    id: `${model.provider}/${model.id}`,
    label: model.name,
    description: `${model.provider}/${model.id}`,
    effortLevels: effortLevels(model),
  }));
}

/** Commands Pi's prompt expansion accepts. Extension commands are excluded because they require
 * ExtensionCommandContext execution rather than a prompt containing `/name`. */
function piCommandCatalog(
  loader: Pick<ResourceLoader, 'getPrompts' | 'getSkills'>,
): AgentCommand[] {
  const commands: AgentCommand[] = [];
  try {
    appendArrayInPlace(
      commands,
      loader.getPrompts().prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description || undefined,
        argumentHint: prompt.argumentHint,
      })),
    );
  } catch {}
  try {
    appendArrayInPlace(
      commands,
      loader.getSkills().skills.map((skill) => ({
        name: `skill:${skill.name}`,
        description: skill.description || undefined,
      })),
    );
  } catch {}
  return commands;
}

function createConfiguredRegistry(
  pi: PiSdk,
  opts: Pick<AgentStartCatalogOptions, 'model' | 'config'>,
  fallbackProvider?: string,
) {
  const authStorage = pi.AuthStorage.create();
  const modelRegistry = pi.ModelRegistry.create(authStorage);
  const cred = readAgentCredential(opts.config);
  let ref = opts.model ? parseModel(opts.model) : null;
  if (!ref && opts.model) {
    const endpointProviders = new Set<string>();
    if (cred.baseUrl) {
      for (const model of modelRegistry.getAll()) {
        if (model.id === opts.model && model.baseUrl === cred.baseUrl) {
          endpointProviders.add(model.provider);
        }
      }
    }
    const endpointProvider =
      endpointProviders.size === 1 ? endpointProviders.values().next().value : undefined;
    const provider = fallbackProvider ?? cred.knownProvider ?? endpointProvider;
    if (!provider) {
      throw new Error(`pi: model must be 'provider/modelId' (got '${opts.model}')`);
    }
    ref = { provider, modelId: opts.model };
  }

  const key = cred.apiKey ?? cred.authToken;
  // The model ref decides which provider pi routes through, so it wins; a resumed session's own
  // last-routed provider comes next, being direct evidence rather than a catalog default; the
  // resolved known provider only replaces the "first available provider" guess.
  const provider =
    ref?.provider ??
    fallbackProvider ??
    cred.knownProvider ??
    modelRegistry.getAvailable()[0]?.provider;
  if (!provider && (key || cred.baseUrl)) {
    throw new Error('pi: cannot target credential without a provider/model');
  }
  if (key && provider) authStorage.setRuntimeApiKey(provider, key);
  if (cred.baseUrl) {
    // baseUrl override only: a models-less registerProvider rewrites the URL and leaves each
    // model's wire at pi's built-in value, so this works exactly when that provider's built-in
    // wire already matches the endpoint. Pointing a provider at a differently-shaped endpoint is
    // not expressible without supplying full model metadata (see @linkcode/providers AGENTS.md).
    modelRegistry.registerProvider(provider, {
      baseUrl: cred.baseUrl,
      ...(key && { apiKey: key }),
    });
  }
  return {
    authStorage,
    modelRegistry,
    ref,
    credentialProviderId: key || cred.baseUrl ? provider : null,
  };
}

/**
 * Pi adapter — drives `@earendil-works/pi-coding-agent` via `createAgentSession()`. Events arrive through
 * `session.subscribe()`; prompts via `session.prompt()` (queued as a follow-up while streaming). Auth and
 * model selection go through Pi's `AuthStorage` / `ModelRegistry`.
 */
export class PiAdapter extends BaseAgentAdapter {
  readonly kind = 'pi' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
    branch: true,
  };

  private session: AgentSession | null = null;
  private unsub: (() => void) | null = null;
  private modelRegistry: PiRegistry | null = null;
  private resumeFrom: AgentHistoryId | null = null;
  private pendingBranchManager: SessionManager | null = null;
  private credentialProviderId: string | null = null;
  private policyId: PiPolicy = 'default';
  private readonly sessionAllowedTools = new Set<string>();
  private initialEffort: PiEffort | null = null;
  private turnActive = false;
  private promptInFlight = false;
  private settlementPending = false;
  private finalOutcome: { stopReason: 'aborted' | 'error' | 'success'; errorMessage?: string } = {
    stopReason: 'success',
  };
  /** Invalidates SDK and extension callbacks captured by a stopped Pi session. */
  private lifecycle = 0;
  private browserTools: BrowserToolsetFactory | undefined;

  attachBrowserTools(createToolset: BrowserToolsetFactory): void {
    this.browserTools = createToolset;
  }

  override async startCatalog(opts: AgentStartCatalogOptions = {}): Promise<AgentStartCatalog> {
    const pi = await this.importSdk();
    const { modelRegistry } = createConfiguredRegistry(pi, opts);
    const models = modelOptions(modelRegistry.getAvailable());
    return {
      models,
      policies: [...POLICIES],
      defaultPolicyId: 'default',
      // The registry's first entry is exactly what an unpicked session falls back to (see onStart).
      ...(models[0] && { defaultModel: models[0].id }),
    };
  }
  override async listHistory(opts?: AgentHistoryListOptions) {
    return listPiHistory(await this.importSdk(), opts);
  }
  override async readHistory(opts: AgentHistoryReadOptions) {
    return readPiHistory(await this.importSdk(), opts);
  }
  override async resumeHistory(opts: AgentHistoryResumeOptions, startOpts: StartOptions) {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }
  override async branchHistory(opts: AgentHistoryBranchOptions, startOpts: StartOptions) {
    const predecessor = decodeHistoryBranchCursor(opts.cursor, 'pi', opts.historyId);
    const pi = await this.importSdk();
    const file = await findPiSessionFile(opts.historyId);
    if (!file) throw new Error(`pi: history '${opts.historyId}' was not found`);
    const sourceManager = pi.SessionManager.open(file);
    if (predecessor !== null) {
      if (!sourceManager.getEntry(predecessor)) {
        throw new Error(`pi: history branch predecessor '${predecessor}' was not found`);
      }
      sourceManager.createBranchedSession(predecessor);
      this.pendingBranchManager = sourceManager;
    } else {
      this.pendingBranchManager = pi.SessionManager.create(
        sourceManager.getCwd(),
        sourceManager.getSessionDir(),
        { parentSession: file },
      );
    }
    await this.start(startOpts);
  }

  private importSdk() {
    const managed = agentRuntimeProber.resolveEntry('pi');
    return this.loadSdk(
      '@earendil-works/pi-coding-agent',
      () =>
        (managed
          ? import(pathToFileURL(managed.path).href)
          : import('@earendil-works/pi-coding-agent')) as Promise<
          typeof import('@earendil-works/pi-coding-agent')
        >,
    );
  }

  protected async onStart(opts: StartOptions): Promise<void> {
    // Reject rather than silently drop (the historyCapabilities discipline): pi's SDK has no MCP
    // support at all, and the engine's injection gate already skips pi — an explicit request
    // reaching here is a caller bug that must not degrade into missing tools.
    if (opts.mcpServers?.length) {
      throw new Error('pi: MCP servers are not supported');
    }
    const generation = ++this.lifecycle;
    const pi = await this.importSdk();
    if (opts.approvalPolicyId) {
      if (!isPolicy(opts.approvalPolicyId)) {
        throw new Error(`pi: unknown approval policy '${opts.approvalPolicyId}'`);
      }
      this.policyId = opts.approvalPolicyId;
    }
    let manager: SessionManager | undefined = this.pendingBranchManager ?? undefined;
    let savedProvider: string | undefined;
    if (manager) {
      savedProvider = lastPiModelChange(manager.getBranch())?.provider;
    } else if (this.resumeFrom) {
      const file = await findPiSessionFile(this.resumeFrom);
      if (!file) throw new Error(`pi: history '${this.resumeFrom}' was not found`);
      manager = pi.SessionManager.open(file);
      savedProvider = lastPiModelChange(manager.getBranch())?.provider;
    }
    // Inject the account's key as a runtime override so it outranks ~/.pi/agent/auth.json and env
    // vars; a gateway base URL is registered on the model registry, overriding the provider's URL.
    const { authStorage, modelRegistry, ref, credentialProviderId } = createConfiguredRegistry(
      pi,
      opts,
      savedProvider,
    );
    this.modelRegistry = modelRegistry;
    this.credentialProviderId = credentialProviderId;
    let model = ref ? modelRegistry.find(ref.provider, ref.modelId) : undefined;
    if (ref && !model) {
      throw new Error(`pi: model '${opts.model}' is not available for provider '${ref.provider}'`);
    }
    if (!manager && !model && opts.model !== null) model = modelRegistry.getAvailable()[0];
    const cwd = manager?.getCwd() ?? opts.cwd;
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: piAgentDir(),
      extensionFactories: [
        (extension) => {
          this.registerGate(extension, generation);
          this.registerBrowserTool(extension);
        },
      ],
    });
    await resourceLoader.reload();

    const { session } = await pi.createAgentSession({
      cwd,
      authStorage,
      modelRegistry,
      resourceLoader,
      ...(model && { model }),
      ...(manager && { sessionManager: manager }),
      ...(this.initialEffort && { thinkingLevel: this.initialEffort }),
      tools: this.tools(),
    });
    this.session = session;
    this.unsub = session.subscribe((ev) => {
      if (this.lifecycle === generation && this.session === session) this.handleEvent(ev);
    });
    const runningModel = session.model ?? model;
    if (runningModel) this.emitModel(`${runningModel.provider}/${runningModel.id}`);
    this.emitModels(
      modelOptions(
        this.credentialProviderId
          ? modelRegistry
              .getAvailable()
              .filter((item) => item.provider === this.credentialProviderId)
          : modelRegistry.getAvailable(),
      ),
    );
    this.emitApprovalPolicy({ availablePolicies: [...POLICIES], currentPolicyId: this.policyId });
    if (isEffort(session.thinkingLevel)) this.emitEffort(session.thinkingLevel);
    if (this.resumeFrom) this.emitSessionRef(this.resumeFrom);
    await session.bindExtensions({
      uiContext: createPiUiContext({
        ask: (tool, questions, signal) =>
          this.lifecycle === generation
            ? this.requestQuestion(tool, questions, signal)
            : Promise.resolve({ outcome: 'cancelled' }),
        reportError: (message) => {
          if (this.lifecycle === generation) this.emitError(`pi: ${message}`, 'extension-error');
        },
      }),
      mode: 'rpc',
      onError: (error) => {
        if (this.lifecycle === generation) {
          this.emitError(
            `pi: extension error (${error.extensionPath}): ${error.error}`,
            'extension-error',
          );
        }
      },
    });
    // Pi has no resource change event in headless mode, so this is a full snapshot. Each resource
    // category is optional session metadata: discovery failure hides only that category.
    this.emitCommands(piCommandCatalog(resourceLoader));
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

  /** Pi expands `/skill:name` and prompt-template commands inside `session.prompt`, so command
   * dispatch shares the normal turn lifecycle and must not re-emit the user's invocation. */
  protected override async onCommand(name: string, args?: string): Promise<void> {
    await this.runPrompt(`/${name}${args ? ` ${args}` : ''}`);
  }

  private async runPrompt(text: string, options?: Pick<PromptOptions, 'images'>): Promise<void> {
    invariant(this.session, 'pi: session not started');
    this.turnActive = true;
    this.promptInFlight = true;
    this.settlementPending = false;
    this.finalOutcome = { stopReason: 'success' };
    this.emitStatus('running');
    try {
      if (this.session.isStreaming) {
        await this.session.prompt(text, { ...options, streamingBehavior: 'followUp' });
      } else await this.session.prompt(text, options);
      this.promptInFlight = false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the subscribe handler flips `settlementPending` while prompt() is awaited
      if (this.settlementPending) this.settleTurn();
    } catch (error) {
      this.promptInFlight = false;
      this.settlementPending = false;
      this.turnActive = false;
      this.teardown();
      this.emitStatus('idle');
      throw error;
    }
  }

  protected override async onCancel(): Promise<void> {
    this.finalOutcome = { stopReason: 'aborted' };
    // Pi waits for extension tool_call/UI handlers before abort() can reach idle. Release their
    // pending host round-trips first so Stop cannot deadlock behind an unanswered prompt.
    this.teardown();
    await this.session?.abort();
  }

  protected override async onSetModel(value: string): Promise<void> {
    const session = this.session;
    const registry = this.modelRegistry;
    if (!session || !registry) throw new Error('pi: session not started');
    const ref = parseModel(value);
    if (!ref) throw new Error(`pi: model must be 'provider/modelId' (got '${value}')`);
    if (this.credentialProviderId && ref.provider !== this.credentialProviderId) {
      throw new Error(`pi: this session's credential is scoped to '${this.credentialProviderId}'`);
    }
    const model = registry.find(ref.provider, ref.modelId);
    if (!model) throw new Error(`pi: unknown model '${value}'`);
    await session.setModel(model);
    if (session.model) this.emitModel(`${session.model.provider}/${session.model.id}`);
    if (isEffort(session.thinkingLevel)) this.emitEffort(session.thinkingLevel);
  }

  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    if (!isEffort(effort)) {
      return Promise.reject(new Error(`pi: effort '${effort}' is not supported (low–xhigh only)`));
    }
    if (!this.session) {
      this.initialEffort = effort;
      return Promise.resolve();
    }
    if (!this.session.supportsThinking()) {
      return Promise.reject(new Error('pi: the current model does not support reasoning effort'));
    }
    this.session.setThinkingLevel(effort);
    if (isEffort(this.session.thinkingLevel)) this.emitEffort(this.session.thinkingLevel);
    return Promise.resolve();
  }

  protected override onSetApprovalPolicy(policyId: string): Promise<void> {
    if (!isPolicy(policyId)) {
      return Promise.reject(new Error(`pi: unknown approval policy '${policyId}'`));
    }
    this.policyId = policyId;
    this.emitApprovalPolicy({ availablePolicies: [...POLICIES], currentPolicyId: policyId });
    return Promise.resolve();
  }

  protected override onStop(): Promise<void> {
    const unsub = this.unsub;
    const session = this.session;
    this.lifecycle += 1;
    this.session = null;
    this.unsub = null;
    this.modelRegistry = null;
    this.credentialProviderId = null;
    this.resumeFrom = null;
    this.pendingBranchManager = null;
    this.sessionAllowedTools.clear();
    this.initialEffort = null;
    this.policyId = 'default';
    this.turnActive = false;
    this.promptInFlight = false;
    this.settlementPending = false;
    this.finalOutcome = { stopReason: 'success' };
    try {
      unsub?.();
    } finally {
      session?.dispose();
    }
    return Promise.resolve();
  }

  private tools(): string[] | undefined {
    const t = this.opts?.config?.tools;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : undefined;
  }

  private registerGate(extension: ExtensionAPI, generation: number): void {
    extension.on('tool_call', (event) => this.gateTool(event, generation));
  }

  private registerBrowserTool(extension: ExtensionAPI): void {
    const factory = this.browserTools;
    if (!factory) return;
    const toolset = factory();
    extension.registerTool({
      name: 'browser_execute',
      label: 'Browser',
      description: toolset.documentation,
      parameters: Type.Object({
        code: Type.String({ description: 'JavaScript for the persistent browser REPL' }),
      }),
      async execute(_toolCallId, { code }) {
        invariant(code, 'pi: browser_execute code is required');
        const rendered = renderBrowserToolResult(await toolset.execute(code));
        return {
          content: [
            { type: 'text', text: rendered.text },
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
          details: undefined,
        };
      },
    });
  }

  private async gateTool(
    event: ToolCallEvent,
    generation: number,
  ): Promise<ToolCallEventResult | undefined> {
    if (this.lifecycle !== generation) return { block: true, reason: 'The Pi session has stopped' };
    if (this.policyId === 'bypassPermissions' || this.sessionAllowedTools.has(event.toolName)) {
      return undefined;
    }
    const kind = toolKindFromName(event.toolName);
    if (AUTO[this.policyId].has(kind)) return undefined;
    const card = {
      toolCallId: event.toolCallId,
      title: event.toolName,
      kind,
      rawInput: event.input,
      locations: locationsFromToolInput(event.input),
    };
    this.emitTool({ ...card, status: 'in_progress' });
    const outcome = await this.requestPermission(
      { title: event.toolName, subject: { type: 'tool-call', toolCallId: event.toolCallId } },
      [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always allow this session', kind: 'allow_always' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    );
    if (this.lifecycle !== generation) return { block: true, reason: 'The Pi session has stopped' };
    if (outcome.outcome === 'cancelled') {
      this.emitTool({ toolCallId: event.toolCallId, status: 'failed' });
      return { block: true, reason: 'Tool call cancelled' };
    }
    if (outcome.optionId === 'always') {
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
        this.turnActive = true;
        this.finalOutcome = { stopReason: 'success' };
        this.freshSegment();
        if (this.session) this.emitSessionRef(asHistoryId(this.session.sessionId));
        this.emitStatus('running');
        break;
      case 'agent_end': {
        const assistant = ev.messages.findLast((message) => message.role === 'assistant');
        if (assistant?.stopReason === 'aborted') {
          this.finalOutcome = { stopReason: 'aborted', errorMessage: assistant.errorMessage };
        } else if (assistant?.stopReason === 'error') {
          this.finalOutcome = { stopReason: 'error', errorMessage: assistant.errorMessage };
        } else this.finalOutcome = { stopReason: 'success' };
        break;
      }
      case 'agent_settled':
        if (this.promptInFlight) this.settlementPending = true;
        else this.settleTurn();
        break;
      case 'message_update': {
        const a = ev.assistantMessageEvent;
        const id = (kind: 'message' | 'thought') => {
          const fallbackId = kind === 'message' ? this.messageId : this.thoughtId;
          if (!('partial' in a)) return fallbackId;
          return piMessageBlockId(
            a.partial.responseId,
            a.partial.timestamp,
            fallbackId,
            'contentIndex' in a ? a.contentIndex : 0,
            kind,
          );
        };
        switch (a.type) {
          case 'text_delta':
            this.emitAssistantText(a.delta, id('message'));
            break;
          case 'thinking_delta':
            this.emitThought(a.delta, id('thought'));
            break;
          case 'text_end':
            this.emitAgentMessage(id('message'), [textBlock(a.content)]);
            break;
          case 'thinking_end':
            this.emitAgentThought(id('thought'), [textBlock(a.content)]);
            break;
          default:
            break;
        }
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
      case 'thinking_level_changed':
        if (isEffort(ev.level)) this.emitEffort(ev.level);
        break;
      default:
        break;
    }
  }

  private settleTurn(): void {
    if (!this.turnActive) return;
    this.turnActive = false;
    this.settlementPending = false;
    this.teardown();
    if (this.finalOutcome.stopReason === 'aborted') this.emitStop('cancelled');
    else if (this.finalOutcome.stopReason === 'error') {
      this.emitProviderError(this.finalOutcome.errorMessage ?? 'Pi agent failed');
    } else this.emitStop('end_turn');
    this.emitStatus('idle');
  }
}
