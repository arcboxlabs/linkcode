import type { SessionId, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { PendingRegistry } from './pending-registry';
import { sendCorrelated } from './pending-registry';

type TerminalOutputCb = (data: string) => void;
type TerminalExitCb = (exitCode: number | null) => void;
type TerminalErrorCb = (err: Error) => void;
type SnapshotCb = () => void;

/** Cap on per-terminal output buffered before the first subscriber, so an unread PTY can't grow unbounded. */
const TERMINAL_PREBUFFER_CAP = 128 * 1024;

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
  private readonly exitSubs = new Map<string, Set<TerminalExitCb>>();
  /** Notified when a fire-and-forget terminal frame (input/resize/close) fails to send. */
  private readonly errorSubs = new Map<string, Set<TerminalErrorCb>>();
  /** Output seen before anyone subscribed (covers the open→subscribe gap and late mounts); capped. */
  private readonly prebuffer = new Map<string, string>();
  /** Accumulated output per terminal, capped — the `outputSnapshot` source. Kept after `terminal.exit`
   * so a still-mounted viewer keeps the final output instead of going blank. */
  private readonly output = new Map<string, string>();
  private readonly snapshotSubs = new Map<string, Set<SnapshotCb>>();

  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
  ) {}

  /** Route a `terminal.*` reply/event. Returns false if `payload` wasn't a terminal message. */
  handleMessage(p: WirePayload): boolean {
    switch (p.kind) {
      case 'terminal.opened': {
        this.pending.resolve('terminalOpen', p.replyTo, p.terminalId);
        return true;
      }
      case 'terminal.output': {
        const subs = this.outputSubs.get(p.terminalId);
        if (subs && subs.size > 0) {
          for (const cb of subs) cb(p.data);
        } else {
          const prev = this.prebuffer.get(p.terminalId) ?? '';
          this.prebuffer.set(p.terminalId, capOutput(prev + p.data, TERMINAL_PREBUFFER_CAP));
        }
        const prevOutput = this.output.get(p.terminalId) ?? '';
        this.output.set(p.terminalId, capOutput(prevOutput + p.data, TERMINAL_OUTPUT_CAP));
        this.notifySnapshotChange(p.terminalId);
        return true;
      }
      case 'terminal.exit': {
        const subs = this.exitSubs.get(p.terminalId);
        if (subs) for (const cb of subs) cb(p.exitCode);
        this.outputSubs.delete(p.terminalId);
        this.exitSubs.delete(p.terminalId);
        this.errorSubs.delete(p.terminalId);
        this.prebuffer.delete(p.terminalId);
        return true;
      }
      default:
        return false;
    }
  }

  open(opts: {
    cols: number;
    rows: number;
    cwd?: string;
    shell?: string;
    sessionId?: SessionId;
  }): Promise<string> {
    return sendCorrelated(this.transport, this.pending, 'terminalOpen', (clientReqId) => ({
      kind: 'terminal.open',
      clientReqId,
      opts,
    }));
  }

  input(terminalId: string, data: string): void {
    this.sendFrame(terminalId, { kind: 'terminal.input', terminalId, data });
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sendFrame(terminalId, { kind: 'terminal.resize', terminalId, cols, rows });
  }

  close(terminalId: string): void {
    this.sendFrame(terminalId, { kind: 'terminal.close', terminalId });
  }

  subscribeOutput(terminalId: string, cb: TerminalOutputCb): Unsubscribe {
    let set = this.outputSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.outputSubs.set(terminalId, set);
    }
    set.add(cb);
    // Replay output buffered before a subscriber attached. Kept (not deleted) until `terminal.exit`
    // so a remount/second subscriber still gets the initial prompt instead of a blank pane.
    const buffered = this.prebuffer.get(terminalId);
    if (buffered !== undefined) cb(buffered);
    return () => set.delete(cb);
  }

  subscribeExit(terminalId: string, cb: TerminalExitCb): Unsubscribe {
    let set = this.exitSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.exitSubs.set(terminalId, set);
    }
    set.add(cb);
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
    this.exitSubs.clear();
    this.errorSubs.clear();
    this.prebuffer.clear();
    this.output.clear();
    this.snapshotSubs.clear();
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
