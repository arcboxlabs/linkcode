import type {
  AgentSession,
  AgentSessionEvent,
  PromptOptions,
} from '@earendil-works/pi-coding-agent';
import type { ContentBlock, StartOptions, StopReason } from '@linkcode/schema';
import { invariant } from 'foxts/guard';
import { BaseAgentAdapter } from '../../base';
import { readAgentCredential } from '../../credential';
import {
  contentToText,
  imageBlocksFrom,
  locationsFromToolInput,
  toolKindFromName,
} from '../../util';
import { createPiUiContext } from './ui-bridge';

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

  private session: AgentSession | null = null;
  private unsub: (() => void) | null = null;

  protected async onStart(opts: StartOptions): Promise<void> {
    const pi = await this.loadSdk(
      '@earendil-works/pi-coding-agent',
      () => import('@earendil-works/pi-coding-agent'),
    );
    const authStorage = pi.AuthStorage.create();
    const modelRegistry = pi.ModelRegistry.create(authStorage);

    let model = modelRegistry.getAvailable()[0];
    if (opts.model) {
      const [provider, ...rest] = opts.model.split('/');
      if (provider && rest.length > 0) {
        const found = modelRegistry.find(provider, rest.join('/'));
        if (found) model = found;
      }
    }

    // Inject the account's key as a runtime override so it outranks ~/.pi/agent/auth.json and env
    // vars; a gateway base URL is registered on the model registry, overriding the provider's URL.
    const cred = readAgentCredential(opts.config);
    const key = cred.apiKey ?? cred.authToken;
    if (key) authStorage.setRuntimeApiKey(model.provider, key);
    if (cred.baseUrl) {
      modelRegistry.registerProvider(model.provider, {
        baseUrl: cred.baseUrl,
        ...(key && { apiKey: key }),
      });
    }

    const { session } = await pi.createAgentSession({
      cwd: opts.cwd,
      authStorage,
      modelRegistry,
      model,
      tools: this.tools(),
    });
    this.session = session;
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
