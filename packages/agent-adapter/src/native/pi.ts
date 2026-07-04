import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ContentBlock, StartOptions } from '@linkcode/schema';
import { invariant } from 'foxts/guard';
import { BaseAgentAdapter } from '../base';
import { contentToText, toolKindFromName } from '../util';

/**
 * Pi adapter — drives `@earendil-works/pi-coding-agent` via `createAgentSession()`. Events arrive through
 * `session.subscribe()`; prompts via `session.prompt()` (queued as a follow-up while streaming). Auth and
 * model selection go through Pi's `AuthStorage` / `ModelRegistry`.
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

    // Pi resolves auth through AuthStorage; inject the configured key as a runtime override for the
    // selected model's provider so it takes precedence over ~/.pi/agent/auth.json and env vars.
    const apiKey = typeof opts.config?.apiKey === 'string' ? opts.config.apiKey : undefined;
    if (apiKey) authStorage.setRuntimeApiKey(model.provider, apiKey);

    const { session } = await pi.createAgentSession({
      cwd: opts.cwd,
      authStorage,
      modelRegistry,
      model,
      tools: this.tools(),
    });
    this.session = session;
    this.unsub = session.subscribe((ev) => this.handleEvent(ev));
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    invariant(this.session, 'pi: session not started');
    const text = contentToText(content);
    this.emitStatus('running');
    if (this.session.isStreaming) {
      await this.session.prompt(text, { streamingBehavior: 'followUp' });
    } else await this.session.prompt(text);
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
      case 'agent_end':
        this.emitStop('end_turn');
        this.emitStatus('idle');
        break;
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
