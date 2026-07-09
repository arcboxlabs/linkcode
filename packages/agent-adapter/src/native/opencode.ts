import type { ContentBlock, StartOptions, ToolCallContent, ToolCallStatus } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Event, Part, TextPartInput } from '@opencode-ai/sdk/v2';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { AUTH_FAILED_ERROR_CODE } from '../adapter';
import { BaseAgentAdapter } from '../base';
import { contentToText, locationsFromToolInput, toolKindFromName } from '../util';

type ToolPartState = Extract<Part, { type: 'tool' }>['state'];
type SessionErrored = Extract<Event, { type: 'session.error' }>['properties'];

/** Cap on how long `onCancel` waits for `session.abort`: opencode has blocked the abort RPC until
 * the running tool actually exits (tens of seconds, observed on 1.14.42+ by paseo; 1.17.11 returns
 * in ~30ms). Past the cap the local cancel proceeds while the abort settles server-side. */
const ABORT_WAIT_MS = 2000;
const ABORT_TIMED_OUT = Symbol('opencode-abort-timeout');

/** Most `session.error` variants carry `data.message`; fall back to the variant name. */
function sessionErrorMessage(error: NonNullable<SessionErrored['error']>): string {
  const message = (error.data as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' && message.length > 0 ? message : error.name;
}

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
  /** True while a turn is in flight (prompt sent, `session.idle` not yet seen) — gates whether the
   * event stream ending is an unexpected failure or an expected side effect of the turn finishing. */
  private turnActive = false;
  /** True once `onCancel` has aborted the in-flight turn — any stream fallout until the next prompt
   * (thrown or clean) is that abort's expected side effect, not a failure. */
  private cancelling = false;
  /** True once a `session.error` failed the active turn — the idle settle then skips the `end_turn`
   * stop (the error event already told the story) and sweeps unsettled tools. */
  private turnFailed = false;
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
    this.turnActive = true;
    this.cancelling = false;
    this.turnFailed = false;
    this.emitStatus('running');
    // promptAsync, not prompt: the blocking variant's HTTP response only resolves once the whole
    // turn finishes, which would hold send() open for the turn's full duration and risks HTTP-layer
    // timeouts on long turns. The SSE stream is the single source of turn lifecycle either way.
    await this.client.session.promptAsync({
      sessionID: this.sessionId,
      directory: this.opts?.cwd,
      model: this.model(),
      parts,
    });
  }

  protected override async onCancel(): Promise<void> {
    this.turnActive = false;
    this.cancelling = true;
    if (!this.client || !this.sessionId) return;
    const abort = this.client.session.abort({
      sessionID: this.sessionId,
      directory: this.opts?.cwd,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raced = await Promise.race([
        abort,
        new Promise<typeof ABORT_TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(ABORT_TIMED_OUT), ABORT_WAIT_MS);
        }),
      ]);
      if (raced === ABORT_TIMED_OUT) {
        // The abort RPC is still in flight server-side (see ABORT_WAIT_MS): proceed with the local
        // cancel and leave `cancelling` latched — the abort's fallout (`session.error` aborted +
        // `session.idle`) is still expected. Detach the pending promise so a late rejection can't
        // become an unhandled rejection.
        void abort.catch(noop);
      }
    } catch (err) {
      // The abort itself failed, so no cancel-induced idle/close is coming to reset the flag.
      // Leaving `cancelling` latched would make `consumeEvents()` swallow a later genuine stream
      // failure as an expected cancel close — clear it here so only a real cancel suppresses.
      this.cancelling = false;
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
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
   * server just closing it.
   *
   * Not every ending is a failure: a turn finishing normally (`session.idle`) closes the stream just
   * like a genuine disconnect would, and so does our own `cancel` aborting the turn — neither should
   * be reported as an error. Only a clean close while a turn is still active (not idle, not
   * cancelled), or the iterator itself throwing outside of a cancel, is a real, unexpected failure. */
  private async consumeEvents(): Promise<void> {
    if (!this.client) return;
    let caught: unknown;
    try {
      // Events are scoped to the per-directory instance: a bare subscribe() only carries the
      // server-cwd instance's bus and silently misses every session event whenever the daemon cwd
      // differs from the session cwd (verified live on opencode 1.17.11).
      const sub = await this.client.event.subscribe({ directory: this.opts?.cwd });
      for await (const ev of sub.stream) {
        if (this.stopped) break;
        this.handleEvent(ev);
      }
    } catch (err) {
      caught = err;
    }
    if (this.stopped || this.cancelling) return;
    // Clean close with no turn in flight (already idle, or never started one) is expected —
    // nothing was interrupted.
    if (!caught && !this.turnActive) return;
    // Nothing resubscribes today (see CODE-9), so this session can no longer receive events.
    // Sweep in-flight state and surface it as fatal — `stopped`, not `idle`, so the UI disables
    // the composer instead of treating this session as still usable.
    this.teardown();
    this.emitError(
      caught
        ? (extractErrorMessage(caught) ?? 'opencode: event stream failed')
        : 'opencode: event stream ended unexpectedly',
      undefined,
      false,
    );
    this.emitStatus('stopped');
  }

  /** Each event is handled in its own try/catch so one malformed event (e.g. an unexpected
   * `properties`/`part` shape) reports an error without ending the whole stream. */
  private handleEvent(ev: Event): void {
    try {
      switch (ev.type) {
        case 'message.part.updated':
          if (ev.properties.sessionID === this.sessionId) this.handlePart(ev.properties.part);
          break;
        case 'session.error':
          if (ev.properties.sessionID === this.sessionId) this.handleSessionError(ev.properties);
          break;
        case 'session.idle':
          if (ev.properties.sessionID === this.sessionId) this.settleTurn();
          break;
        default:
          break;
      }
    } catch (err) {
      this.emitError(extractErrorMessage(err) ?? `opencode: failed to handle event (${ev.type})`);
    }
  }

  /** Turn settle on `session.idle`. Guarded on turn liveness so the duplicate idle opencode emits
   * after an abort (observed live: error → idle → idle) doesn't double-report a stop. */
  private settleTurn(): void {
    if (!this.turnActive && !this.cancelling && !this.turnFailed) return;
    const cancelled = this.cancelling;
    const failed = this.turnFailed;
    this.turnActive = false;
    this.cancelling = false;
    this.turnFailed = false;
    // A cancelled or failed turn never delivers its remaining tool settles; sweep them (idempotent
    // after the base cancel-path teardown).
    if (cancelled || failed) this.teardown();
    if (cancelled) this.emitStop('cancelled');
    else if (!failed) this.emitStop('end_turn');
    this.emitStatus('idle');
  }

  /** `session.error` arrives both mid-turn (failing it) and as a post-idle duplicate (observed
   * live: the same failure re-emitted with a stack trace after the settle) — the turn-liveness
   * gate keeps duplicates out. `session.idle` still follows every error and does the settle. */
  private handleSessionError(props: SessionErrored): void {
    const error = props.error;
    if (!error) return;
    if (error.name === 'MessageAbortedError') {
      // The abort's own fallout (ours, or an external client's): fold it into the cancel path so
      // the idle settle reports `cancelled` — never surface it as an error.
      if (this.turnActive || this.cancelling) {
        this.turnActive = false;
        this.cancelling = true;
      }
      return;
    }
    if (!this.turnActive && !this.cancelling) return;
    this.turnFailed = true;
    const message = sessionErrorMessage(error);
    if (error.name === 'ProviderAuthError') {
      this.emitError(
        `opencode: provider authentication failed (${message})`,
        AUTH_FAILED_ERROR_CODE,
        false,
      );
      return;
    }
    this.emitError(message);
  }

  private handlePart(part: Part): void {
    switch (part.type) {
      case 'text': {
        this.streamDelta(part.id, part.text, 'message');

        break;
      }
      case 'reasoning': {
        this.streamDelta(part.id, part.text, 'thought');

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
          locations: locationsFromToolInput(part.state.input),
        });

        break;
      }
      default:
        break;
    }
  }
}
