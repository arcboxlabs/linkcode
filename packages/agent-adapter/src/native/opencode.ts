import type {
  ContentBlock,
  MessageId,
  StartOptions,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Event, Part, TextPartInput } from '@opencode-ai/sdk/v2';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { BaseAgentAdapter } from '../base';
import { contentToText, toolKindFromName } from '../util';

type ToolPartState = Extract<Part, { type: 'tool' }>['state'];

/** Map OpenCode's tool part state to our ToolCallStatus (running → in_progress, error → failed). */
function mapOpencodeToolStatus(status: ToolPartState['status']): ToolCallStatus {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Surface a terminal tool state's output (completed) or error message (error) as tool-call content. */
function toolStateContent(state: ToolPartState): ToolCallContent[] {
  if (state.status === 'completed' && state.output.length > 0) {
    return [{ type: 'content', content: textBlock(state.output) }];
  }
  if (state.status === 'error' && state.error.length > 0) {
    return [{ type: 'content', content: textBlock(state.error) }];
  }
  return [];
}

type OpencodeModule = typeof import('@opencode-ai/sdk/v2');
type OpencodeClient = Awaited<ReturnType<OpencodeModule['createOpencode']>>['client'];

/**
 * OpenCode adapter — the server/client model. `createOpencode()` spawns a local OpenCode server and returns
 * an HTTP client; we own that server's lifecycle. A prompt is sent with `session.prompt`, and the response
 * streams back over the SSE `event.subscribe()` stream (filtered to our session).
 */
export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'opencode' as const;

  private client: OpencodeClient | null = null;
  private closeServer: (() => void) | null = null;
  private sessionId: string | null = null;
  private stopped = false;
  /** Per-part cursor for turning OpenCode's cumulative part text into deltas. */
  private readonly textLen = new Map<string, number>();

  protected async onStart(opts: StartOptions): Promise<void> {
    const mod = await this.loadSdk('@opencode-ai/sdk', () => import('@opencode-ai/sdk/v2'));
    let started: Awaited<ReturnType<OpencodeModule['createOpencode']>>;
    // OpenCode routes by provider; inject the configured key under the model's provider id (the
    // `providerID` half of `providerID/modelID`) so the spawned server authenticates that provider.
    const apiKey = typeof opts.config?.apiKey === 'string' ? opts.config.apiKey : undefined;
    const providerID = opts.model?.includes('/') ? opts.model.split('/', 1)[0] : undefined;
    const serverOptions =
      apiKey && providerID
        ? { config: { provider: { [providerID]: { options: { apiKey } } } } }
        : undefined;
    try {
      started = await mod.createOpencode(serverOptions);
    } catch (err) {
      const detail = extractErrorMessage(err) ?? 'Unknown error';
      this.emitError(`opencode: failed to start server (${detail})`, 'sdk-unavailable', false);
      throw new Error(detail, { cause: err });
    }
    this.client = started.client;
    this.closeServer = () => started.server.close();
    const created = await this.client.session.create({ directory: opts.cwd });
    const id = created.data?.id;
    if (!id) throw new Error('opencode: failed to create session');
    this.sessionId = id;
    void this.consumeEvents();
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (!this.client || !this.sessionId) throw new Error('opencode: session not started');
    const parts: TextPartInput[] = [{ type: 'text', text: contentToText(content) }];
    this.emitStatus('running');
    await this.client.session.prompt({
      sessionID: this.sessionId,
      directory: this.opts?.cwd,
      model: this.model(),
      parts,
    });
  }

  protected override async onCancel(): Promise<void> {
    if (this.client && this.sessionId) {
      await this.client.session.abort({ sessionID: this.sessionId });
    }
  }

  protected override onStop(): Promise<void> {
    this.stopped = true;
    this.closeServer?.();
    return Promise.resolve();
  }

  // No onSetModel override: like claude-code's persistent Query (BaseAgentAdapter#onSetModel calls
  // Query#setModel()), opencode's this.model() also re-derives from this.opts?.model fresh every
  // onPrompt call — the mechanism looks live-switchable — but this has not been verified against a
  // real provider yet (claude-code's own "looks live-switchable from reading the code" turned out
  // wrong the first time, before it moved off the single-message + resume design that silently
  // ignored the override). Falls back to the base class's reject until someone verifies it live.

  private model(): { providerID: string; modelID: string } | undefined {
    const m = this.opts?.model;
    if (!m) return undefined;
    const [providerID, ...rest] = m.split('/');
    if (!providerID || rest.length === 0) return undefined;
    return { providerID, modelID: rest.join('/') };
  }

  /** Runs for the whole session, dispatching every SSE event the OpenCode server pushes over the
   * single long-lived `event.subscribe()` stream (subscribed once in `onStart`). Only returns when
   * that stream ends — `subscribe()` rejecting up front, the iterator throwing mid-stream, or the
   * server just closing it. */
  private async consumeEvents(): Promise<void> {
    if (!this.client) return;
    let caught: unknown;
    try {
      const sub = await this.client.event.subscribe();
      for await (const ev of sub.stream) {
        if (this.stopped) break;
        this.handleEvent(ev);
      }
    } catch (err) {
      caught = err;
    }
    if (this.stopped) return;
    // Nothing resubscribes today (see CODE-9), so however the stream ended — thrown or just
    // closed — this session can no longer receive events. Sweep in-flight state and surface it
    // instead of going silently deaf.
    this.teardown();
    this.emitError(
      caught
        ? (extractErrorMessage(caught) ?? 'opencode: event stream failed')
        : 'opencode: event stream ended unexpectedly',
      undefined,
      false,
    );
    this.emitStatus('idle');
  }

  /** Each event is handled in its own try/catch so one malformed event (e.g. an unexpected
   * `properties`/`part` shape) reports an error without ending the whole stream. */
  private handleEvent(ev: Event): void {
    try {
      switch (ev.type) {
        case 'message.part.updated':
          if (ev.properties.sessionID === this.sessionId) this.handlePart(ev.properties.part);
          break;
        case 'session.idle':
          if (ev.properties.sessionID === this.sessionId) {
            this.emitStop('end_turn');
            this.emitStatus('idle');
          }
          break;
        default:
          break;
      }
    } catch (err) {
      this.emitError(extractErrorMessage(err) ?? `opencode: failed to handle event (${ev.type})`);
    }
  }

  private handlePart(part: Part): void {
    switch (part.type) {
      case 'text': {
        this.streamPartText(part.id, part.text, 'message');

        break;
      }
      case 'reasoning': {
        this.streamPartText(part.id, part.text, 'thought');

        break;
      }
      case 'tool': {
        this.emitTool({
          toolCallId: part.id,
          title: part.tool,
          kind: toolKindFromName(part.tool),
          status: mapOpencodeToolStatus(part.state.status),
          content: toolStateContent(part.state),
          rawInput: part.state.input,
          rawOutput: part.state.status === 'completed' ? part.state.output : undefined,
        });

        break;
      }
      default:
        break;
    }
  }

  private streamPartText(partId: string, full: string, kind: 'message' | 'thought'): void {
    const prev = this.textLen.get(partId) ?? 0;
    if (full.length <= prev) return;
    const delta = full.slice(prev);
    this.textLen.set(partId, full.length);
    if (kind === 'message') this.emitAssistantText(delta, partId as MessageId);
    else this.emitThought(delta, partId as MessageId);
  }
}
