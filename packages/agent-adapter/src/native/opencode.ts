import type {
  ContentBlock,
  MessageId,
  StartOptions,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Event, Part, TextPartInput } from '@opencode-ai/sdk/v2';
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
    try {
      started = await mod.createOpencode();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.emitError(`opencode: failed to start server (${detail})`, 'sdk-unavailable', false);
      throw err instanceof Error ? err : new Error(detail);
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

  private model(): { providerID: string; modelID: string } | undefined {
    const m = this.opts?.model;
    if (!m) return undefined;
    const [providerID, ...rest] = m.split('/');
    if (!providerID || rest.length === 0) return undefined;
    return { providerID, modelID: rest.join('/') };
  }

  private async consumeEvents(): Promise<void> {
    if (!this.client) return;
    const sub = await this.client.event.subscribe();
    for await (const ev of sub.stream) {
      if (this.stopped) break;
      this.handleEvent(ev);
    }
  }

  private handleEvent(ev: Event): void {
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
