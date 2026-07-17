import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  PromptOptions,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ContentBlock,
  StartOptions,
  StopReason,
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
  readPiHistory,
} from './history';
import { createPiUiContext } from './ui-bridge';

type PiModel = NonNullable<CreateAgentSessionOptions['model']>;

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
    if (provider) {
      if (key) authStorage.setRuntimeApiKey(provider, key);
      if (cred.baseUrl) {
        modelRegistry.registerProvider(provider, {
          baseUrl: cred.baseUrl,
          ...(key && { apiKey: key }),
        });
      }
    }

    const { session, modelFallbackMessage } = await pi.createAgentSession({
      // A resumed session runs in its own recorded cwd, not the caller's.
      cwd: sessionManager?.getCwd() ?? opts.cwd,
      authStorage,
      modelRegistry,
      ...(model && { model }),
      ...(sessionManager && { sessionManager }),
      tools: this.tools(),
    });
    this.session = session;
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
