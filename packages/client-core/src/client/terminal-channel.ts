import type {
  TerminalAttachmentCredentials,
  TerminalAttachmentMode,
  TerminalMetadata,
  TerminalReplayEvent,
  WirePayload,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import type { PendingRegistry, RandomUUID } from './pending-registry';
import { sendCorrelated } from './pending-registry';

type TerminalOutputCb = (data: string) => void;
type TerminalEventCb = (event: TerminalReplayEvent) => void;
type TerminalExitCb = (exitCode: number | null) => void;
type TerminalErrorCb = (err: Error) => void;
type SnapshotCb = () => void;
type ControllerCb = (canControl: boolean) => void;
type ReplayTruncatedCb = (truncated: boolean) => void;

interface AttachmentState {
  credentials: TerminalAttachmentCredentials;
  retainCount: number;
  result: { terminal: TerminalMetadata; truncated: boolean } | null;
}

/** Client-side remount replay is only a cache; the daemon remains the authoritative replay source. */
const TERMINAL_REPLAY_DATA_CAP = 10 * 1024 * 1024;
const TERMINAL_REPLAY_EVENT_CAP = 10000;
const TERMINAL_RESIZE_REPLAY_BYTES = 16;
const textEncoder = new TextEncoder();

function replayEventBytes(event: TerminalReplayEvent): number {
  return event.type === 'write'
    ? textEncoder.encode(event.data).byteLength
    : TERMINAL_RESIZE_REPLAY_BYTES;
}

/**
 * Cap on retained accumulated output, in characters (see {@link TerminalChannel.outputSnapshot}).
 * This backs a read-only display buffer, so unbounded agent output would otherwise grow memory and
 * per-chunk re-render cost without limit.
 */
const TERMINAL_OUTPUT_CAP = 200000;

/**
 * Trim buffered terminal output to a cap on a line boundary. Slicing raw would leave the buffer
 * starting mid-ANSI-escape (the head byte gone, the tail rendered as literal garbage); dropping the
 * partial leading line keeps the replay parseable.
 */
function capOutput(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const sliced = text.slice(-cap);
  const nl = sliced.indexOf('\n');
  return nl === -1 ? sliced : sliced.slice(nl + 1);
}

function toError(err: unknown): Error {
  return new Error(extractErrorMessage(err) ?? 'Unknown error');
}

/**
 * Terminal open/input/resize/close plus the output/exit/error subscriptions and the accumulated
 * output snapshot `useTerminalOutput` reads via `useSyncExternalStore`.
 */
export class TerminalChannel {
  private readonly outputSubs = new Map<string, Set<TerminalOutputCb>>();
  private readonly eventSubs = new Map<string, Set<TerminalEventCb>>();
  private readonly exitSubs = new Map<string, Set<TerminalExitCb>>();
  /** Notified when a fire-and-forget terminal frame (input/resize/close) fails to send. */
  private readonly errorSubs = new Map<string, Set<TerminalErrorCb>>();
  /** Ordered write/resize journal used to rebuild Restty after a mount or device attach. */
  private readonly replay = new Map<string, TerminalReplayEvent[]>();
  private readonly replayDataSize = new Map<string, number>();
  private readonly replayTruncated = new Map<string, boolean>();
  private readonly replayTruncatedSubs = new Map<string, Set<ReplayTruncatedCb>>();
  private readonly lastSeq = new Map<string, number>();
  private readonly exits = new Map<string, number | null>();
  /** Accumulated output per terminal, capped — the `outputSnapshot` source. Kept after `terminal.exit`
   * so a still-mounted viewer keeps the final output instead of going blank. */
  private readonly output = new Map<string, string>();
  private readonly snapshotSubs = new Map<string, Set<SnapshotCb>>();
  private readonly controllerSubs = new Map<string, Set<ControllerCb>>();
  private readonly controllers = new Map<string, string | null>();
  private readonly attachments = new Map<string, AttachmentState>();
  private readonly viewAttachPromises = new Map<
    string,
    Promise<{ terminal: TerminalMetadata; truncated: boolean }>
  >();
  private readonly controlAttachPromises = new Map<
    string,
    Promise<{ terminal: TerminalMetadata; truncated: boolean }>
  >();
  private readonly pendingAttachments = new Map<string, AttachmentState>();

  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
    private readonly randomUUID: RandomUUID,
  ) {}

  /** Route a `terminal.*` reply/event. Returns false if `payload` wasn't a terminal message. */
  handleMessage(p: WirePayload): boolean {
    switch (p.kind) {
      case 'terminal.listed': {
        this.pending.resolve('terminalList', p.replyTo, p.terminals);
        return true;
      }
      case 'terminal.opened': {
        const pending = this.pendingAttachments.get(p.replyTo);
        if (pending) {
          this.acceptAttachment(pending, p.terminal, p.replay, p.cutoffSeq, p.truncated);
        }
        this.pending.resolve('terminalOpen', p.replyTo, p.terminal.terminalId);
        return true;
      }
      case 'terminal.attached': {
        const pending = this.pendingAttachments.get(p.replyTo);
        if (!pending) return true;
        const result = this.acceptAttachment(
          pending,
          p.terminal,
          p.replay,
          p.cutoffSeq,
          p.truncated,
        );
        if (pending.retainCount === 0) this.releaseAttachment(p.terminal.terminalId);
        this.pending.resolve('terminalAttach', p.replyTo, result);
        return true;
      }
      case 'terminal.output': {
        if (this.attachments.get(p.terminalId)?.result) {
          this.ingestEvent(p.terminalId, { type: 'write', seq: p.seq, data: p.data });
        }
        return true;
      }
      case 'terminal.resized': {
        if (this.attachments.get(p.terminalId)?.result) {
          this.ingestEvent(p.terminalId, {
            type: 'resize',
            seq: p.seq,
            cols: p.cols,
            rows: p.rows,
          });
        }
        return true;
      }
      case 'terminal.controller.changed': {
        if (this.attachments.get(p.terminalId)?.result) {
          this.setController(p.terminalId, p.controllerAttachmentId);
        }
        return true;
      }
      case 'terminal.exit': {
        this.exits.set(p.terminalId, p.exitCode);
        const subs = this.exitSubs.get(p.terminalId);
        if (subs) for (const cb of subs) cb(p.exitCode);
        this.outputSubs.delete(p.terminalId);
        this.eventSubs.delete(p.terminalId);
        this.exitSubs.delete(p.terminalId);
        this.errorSubs.delete(p.terminalId);
        this.setController(p.terminalId, null);
        this.controllerSubs.delete(p.terminalId);
        return true;
      }
      default:
        return false;
    }
  }

  open(opts: { cols: number; rows: number; cwd?: string; shell?: string }): Promise<string> {
    const state: AttachmentState = {
      credentials: this.newCredentials(),
      retainCount: 1,
      result: null,
    };
    let requestId = '';
    return sendCorrelated(this.transport, this.pending, 'terminalOpen', (clientReqId) => {
      requestId = clientReqId;
      this.pendingAttachments.set(clientReqId, state);
      return { kind: 'terminal.open', clientReqId, opts, ...state.credentials };
    }).finally(() => this.pendingAttachments.delete(requestId));
  }

  list(): Promise<TerminalMetadata[]> {
    return sendCorrelated(this.transport, this.pending, 'terminalList', (clientReqId) => ({
      kind: 'terminal.list',
      clientReqId,
    }));
  }

  attach(terminalId: string): Promise<{ terminal: TerminalMetadata; truncated: boolean }> {
    const existing = this.attachments.get(terminalId);
    if (existing) {
      existing.retainCount += 1;
      const pending = this.viewAttachPromises.get(terminalId);
      if (pending) return pending;
      if (existing.result) return Promise.resolve(existing.result);
    }

    const state = existing ?? { credentials: this.newCredentials(), retainCount: 1, result: null };
    this.attachments.set(terminalId, state);
    const promise = this.requestAttach(terminalId, state, 'view');
    this.viewAttachPromises.set(terminalId, promise);
    void promise
      .catch(() => {
        if (this.attachments.get(terminalId) === state) this.forgetAttachment(terminalId);
      })
      .finally(() => {
        if (this.viewAttachPromises.get(terminalId) === promise) {
          this.viewAttachPromises.delete(terminalId);
        }
      });
    return promise;
  }

  takeControl(terminalId: string): Promise<{ terminal: TerminalMetadata; truncated: boolean }> {
    const state = this.attachments.get(terminalId);
    if (!state || state.retainCount === 0) {
      return Promise.reject(new Error(`terminal ${terminalId} is not attached`));
    }
    if (this.canControl(terminalId) && state.result) return Promise.resolve(state.result);

    const pendingControl = this.controlAttachPromises.get(terminalId);
    if (pendingControl) return pendingControl;
    const pendingView = this.viewAttachPromises.get(terminalId);
    if (pendingView) return pendingView.then(() => this.takeControl(terminalId));

    const promise = this.requestAttach(terminalId, state, 'control');
    this.controlAttachPromises.set(terminalId, promise);
    const clearPendingControl = (): void => {
      if (this.controlAttachPromises.get(terminalId) === promise) {
        this.controlAttachPromises.delete(terminalId);
      }
      if (
        this.attachments.get(terminalId) === state &&
        state.retainCount === 0 &&
        !this.viewAttachPromises.has(terminalId) &&
        !this.controlAttachPromises.has(terminalId)
      ) {
        this.releaseAttachment(terminalId);
      }
    };
    void promise.catch(clearPendingControl);
    void promise.then(clearPendingControl).catch(noop);
    return promise;
  }

  detach(terminalId: string): void {
    const state = this.attachments.get(terminalId);
    if (!state) return;
    state.retainCount = Math.max(0, state.retainCount - 1);
    if (state.retainCount > 0) return;
    if (this.viewAttachPromises.has(terminalId) || this.controlAttachPromises.has(terminalId)) {
      return;
    }
    this.releaseAttachment(terminalId);
  }

  input(terminalId: string, data: string): void {
    const credentials = this.controllerCredentials(terminalId);
    if (!credentials) return;
    this.sendFrame(terminalId, { kind: 'terminal.input', terminalId, data, ...credentials });
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const credentials = this.controllerCredentials(terminalId);
    if (!credentials) return;
    this.sendFrame(terminalId, {
      kind: 'terminal.resize',
      terminalId,
      cols,
      rows,
      ...credentials,
    });
  }

  close(terminalId: string): void {
    const credentials = this.controllerCredentials(terminalId);
    if (!credentials) return;
    this.sendFrame(terminalId, { kind: 'terminal.close', terminalId, ...credentials });
  }

  subscribeOutput(terminalId: string, cb: TerminalOutputCb): Unsubscribe {
    let set = this.outputSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.outputSubs.set(terminalId, set);
    }
    set.add(cb);
    const replay = this.replay.get(terminalId);
    if (replay) {
      for (const event of replay) if (event.type === 'write') cb(event.data);
    }
    return () => set.delete(cb);
  }

  subscribeEvents(terminalId: string, cb: TerminalEventCb): Unsubscribe {
    let set = this.eventSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.eventSubs.set(terminalId, set);
    }
    set.add(cb);
    const replay = this.replay.get(terminalId);
    if (replay) for (const event of replay) cb(event);
    return () => set.delete(cb);
  }

  subscribeExit(terminalId: string, cb: TerminalExitCb): Unsubscribe {
    let set = this.exitSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.exitSubs.set(terminalId, set);
    }
    set.add(cb);
    if (this.exits.has(terminalId)) cb(this.exits.get(terminalId) ?? null);
    return () => set.delete(cb);
  }

  subscribeError(terminalId: string, cb: TerminalErrorCb): Unsubscribe {
    let set = this.errorSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.errorSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  canControl(terminalId: string): boolean {
    const state = this.attachments.get(terminalId);
    return Boolean(state && this.controllers.get(terminalId) === state.credentials.attachmentId);
  }

  subscribeController(terminalId: string, cb: ControllerCb): Unsubscribe {
    let set = this.controllerSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.controllerSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  replayWasTruncated(terminalId: string): boolean {
    return this.replayTruncated.get(terminalId) === true;
  }

  subscribeReplayTruncated(terminalId: string, cb: ReplayTruncatedCb): Unsubscribe {
    let set = this.replayTruncatedSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.replayTruncatedSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  /**
   * Accumulated output for a terminal, capped at {@link TERMINAL_OUTPUT_CAP}. A plain string is
   * always a stable `useSyncExternalStore` snapshot — two calls with no new output return equal
   * (by value) primitives — without needing a cached array-like wrapper.
   */
  outputSnapshot(terminalId: string): string {
    return this.output.get(terminalId) ?? '';
  }

  subscribeOutputSnapshot(terminalId: string, cb: SnapshotCb): Unsubscribe {
    let set = this.snapshotSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.snapshotSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  disposeAll(): void {
    this.outputSubs.clear();
    this.eventSubs.clear();
    this.exitSubs.clear();
    this.errorSubs.clear();
    this.replay.clear();
    this.replayDataSize.clear();
    this.replayTruncated.clear();
    this.replayTruncatedSubs.clear();
    this.lastSeq.clear();
    this.exits.clear();
    this.output.clear();
    this.snapshotSubs.clear();
    this.controllerSubs.clear();
    this.controllers.clear();
    this.attachments.clear();
    this.viewAttachPromises.clear();
    this.controlAttachPromises.clear();
    this.pendingAttachments.clear();
  }

  private newCredentials(): TerminalAttachmentCredentials {
    return {
      attachmentId: this.randomUUID(),
      attachmentSecret: this.randomUUID(),
    };
  }

  private adoptAttachment(terminal: TerminalMetadata, state: AttachmentState): void {
    this.attachments.set(terminal.terminalId, state);
    this.setController(terminal.terminalId, terminal.controllerAttachmentId);
  }

  private acceptAttachment(
    state: AttachmentState,
    terminal: TerminalMetadata,
    replay: TerminalReplayEvent[],
    cutoffSeq: number,
    truncated: boolean,
  ): { terminal: TerminalMetadata; truncated: boolean } {
    this.adoptAttachment(terminal, state);
    if (truncated) this.markReplayTruncated(terminal.terminalId);
    for (const event of replay) this.ingestEvent(terminal.terminalId, event);
    this.lastSeq.set(
      terminal.terminalId,
      Math.max(this.lastSeq.get(terminal.terminalId) ?? 0, cutoffSeq),
    );
    const result = { terminal, truncated: this.replayWasTruncated(terminal.terminalId) };
    state.result = result;
    return result;
  }

  private requestAttach(
    terminalId: string,
    state: AttachmentState,
    mode: TerminalAttachmentMode,
  ): Promise<{ terminal: TerminalMetadata; truncated: boolean }> {
    let requestId = '';
    return sendCorrelated(this.transport, this.pending, 'terminalAttach', (clientReqId) => {
      requestId = clientReqId;
      this.pendingAttachments.set(clientReqId, state);
      return {
        kind: 'terminal.attach',
        clientReqId,
        terminalId,
        mode,
        ...state.credentials,
      };
    }).finally(() => this.pendingAttachments.delete(requestId));
  }

  private releaseAttachment(terminalId: string): void {
    const state = this.attachments.get(terminalId);
    if (!state) return;
    this.sendFrame(terminalId, {
      kind: 'terminal.detach',
      terminalId,
      ...state.credentials,
    });
    this.forgetAttachment(terminalId);
    this.clearCachedTerminal(terminalId);
  }

  private forgetAttachment(terminalId: string): void {
    const controlled = this.canControl(terminalId);
    this.attachments.delete(terminalId);
    this.controllers.delete(terminalId);
    if (controlled) this.notifyControllerChange(terminalId);
  }

  private controllerCredentials(terminalId: string): TerminalAttachmentCredentials | undefined {
    return this.canControl(terminalId) ? this.attachments.get(terminalId)?.credentials : undefined;
  }

  private setController(terminalId: string, attachmentId: string | null): void {
    const before = this.canControl(terminalId);
    this.controllers.set(terminalId, attachmentId);
    if (before !== this.canControl(terminalId)) this.notifyControllerChange(terminalId);
  }

  private notifyControllerChange(terminalId: string): void {
    const canControl = this.canControl(terminalId);
    const subs = this.controllerSubs.get(terminalId);
    if (subs) for (const cb of subs) cb(canControl);
  }

  private ingestEvent(terminalId: string, event: TerminalReplayEvent): void {
    if (event.seq <= (this.lastSeq.get(terminalId) ?? 0)) return;
    this.lastSeq.set(terminalId, event.seq);
    this.appendReplayEvent(terminalId, event);

    const eventSubs = this.eventSubs.get(terminalId);
    if (eventSubs) for (const cb of eventSubs) cb(event);
    if (event.type !== 'write') return;

    const outputSubs = this.outputSubs.get(terminalId);
    if (outputSubs) for (const cb of outputSubs) cb(event.data);
    const previous = this.output.get(terminalId) ?? '';
    this.output.set(terminalId, capOutput(previous + event.data, TERMINAL_OUTPUT_CAP));
    this.notifySnapshotChange(terminalId);
  }

  private appendReplayEvent(terminalId: string, event: TerminalReplayEvent): void {
    const replay = [...(this.replay.get(terminalId) ?? []), event];
    let dataSize = (this.replayDataSize.get(terminalId) ?? 0) + replayEventBytes(event);

    let truncated = false;
    while (
      replay.length > 0 &&
      (replay.length > TERMINAL_REPLAY_EVENT_CAP || dataSize > TERMINAL_REPLAY_DATA_CAP)
    ) {
      const removed = replay.shift();
      if (!removed) break;
      dataSize -= replayEventBytes(removed);
      truncated = true;
    }
    this.replay.set(terminalId, replay);
    this.replayDataSize.set(terminalId, dataSize);
    if (truncated) this.markReplayTruncated(terminalId);
  }

  private markReplayTruncated(terminalId: string): void {
    if (this.replayTruncated.get(terminalId) === true) return;
    this.replayTruncated.set(terminalId, true);
    const subs = this.replayTruncatedSubs.get(terminalId);
    if (subs) for (const cb of subs) cb(true);
  }

  private clearCachedTerminal(terminalId: string): void {
    this.replay.delete(terminalId);
    this.replayDataSize.delete(terminalId);
    this.lastSeq.delete(terminalId);
    this.exits.delete(terminalId);
    this.output.delete(terminalId);
    this.notifySnapshotChange(terminalId);
    if (this.replayTruncated.delete(terminalId)) {
      const subs = this.replayTruncatedSubs.get(terminalId);
      if (subs) for (const cb of subs) cb(false);
    }
  }

  /** Send a fire-and-forget terminal frame, routing any send failure to the terminal's error subs. */
  private sendFrame(terminalId: string, payload: WirePayload): void {
    const onFail = (err: unknown) => this.emitError(terminalId, toError(err));
    try {
      void Promise.resolve(this.transport.send(createWireMessage(payload))).catch(onFail);
    } catch (err) {
      onFail(err);
    }
  }

  private emitError(terminalId: string, err: Error): void {
    const subs = this.errorSubs.get(terminalId);
    if (subs) for (const cb of subs) cb(err);
  }

  private notifySnapshotChange(terminalId: string): void {
    const subs = this.snapshotSubs.get(terminalId);
    if (subs) for (const cb of subs) cb();
  }
}
