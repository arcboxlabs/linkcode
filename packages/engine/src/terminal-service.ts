import type {
  SessionId,
  TerminalAttachmentCredentials,
  TerminalAttachmentMode,
  TerminalMetadata,
  WirePayload,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import type { ResttyHeadlessTerminal } from 'restty/headless';
import { createHeadlessTerminal } from 'restty/headless';
import type { ResttyWasm } from 'restty/internal';
import { loadResttyWasm } from 'restty/internal';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from './pty-backend';
import { TerminalReplayJournal } from './terminal-replay';

interface TerminalRecord {
  metadata: TerminalMetadata;
  replay: TerminalReplayJournal;
}

interface TerminalEntry extends TerminalRecord {
  process: PtyProcess;
  headless: ResttyHeadlessTerminal;
  attachments: Map<string, string>;
  /** Flush PTY bytes queued for microtask coalescing before any ordered non-write event. */
  flushOutput: () => void;
  reapTimer?: ReturnType<typeof setTimeout>;
  disposed: boolean;
  /** Set for agent-owned terminals so `killBySession` can reap them when the session stops. */
  sessionId?: SessionId;
  /** Engine-owned (e.g. a workspace script): survives client disconnects, dies with its owner. */
  managed?: boolean;
  unsubData: Unsubscribe;
  unsubExit: Unsubscribe;
}

interface ExitedTerminalEntry extends TerminalRecord {
  exitCode: number | null;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface SpawnedTerminal {
  terminalId: string;
  releaseExit: () => void;
}

/** Force a flush once the coalescing buffer reaches this, so one wire message can't grow unbounded. */
const OUTPUT_FLUSH_CAP = 256 * 1024;
const HOST_TERMINAL_REAP_DELAY_MS = 60000;
const EXITED_TERMINAL_RETENTION_MS = 60000;

/**
 * Owns the host's live terminals and short-lived exited replay tombstones, bridging a
 * {@link PtyBackend} to the `terminal.*` wire. Output is coalesced per microtask so a full-speed
 * PTY doesn't emit one Zod-validated wire message per tiny write.
 */
export class TerminalService {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly exitedTerminals = new Map<string, ExitedTerminalEntry>();
  private wasm?: Promise<ResttyWasm>;
  private seq = 0;

  constructor(
    private readonly backend: PtyBackend,
    private readonly transport: Transport,
    /** Liveness check for the owning session; lets `open` bail if the session stopped mid-spawn. */
    private readonly isSessionActive?: (sessionId: SessionId) => boolean,
  ) {}

  /** Spawn a terminal with its initial controller already attached. */
  async open(
    clientReqId: string,
    opts: PtyOpenOptions & { sessionId?: SessionId },
    attachment: TerminalAttachmentCredentials,
  ): Promise<void> {
    const spawned = await this.spawn(opts, { sessionId: opts.sessionId, attachment });
    const entry = this.terminals.get(spawned.terminalId);
    entry?.flushOutput();
    const record = entry ?? this.exitedTerminals.get(spawned.terminalId);
    if (!record) throw new Error(`terminal ${spawned.terminalId} disappeared while opening`);
    try {
      this.send({
        kind: 'terminal.opened',
        replyTo: clientReqId,
        terminal: this.metadata(record),
        replay: record.replay.snapshot(),
        cutoffSeq: record.replay.cutoffSeq,
        truncated: record.replay.truncated,
      });
      if (entry) this.sendController(entry);
    } finally {
      spawned.releaseExit();
    }
  }

  list(clientReqId: string): void {
    this.send({
      kind: 'terminal.listed',
      replyTo: clientReqId,
      terminals: Array.from(this.terminals.values(), (entry) => this.metadata(entry)),
    });
  }

  /** Attach as a viewer, or atomically take exclusive control. */
  attach(
    clientReqId: string,
    terminalId: string,
    attachment: TerminalAttachmentCredentials,
    mode: TerminalAttachmentMode,
  ): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      const exited = this.exitedTerminals.get(terminalId);
      if (!exited) throw new Error(`terminal ${terminalId} is not running`);
      if (mode === 'control') throw new Error(`terminal ${terminalId} has exited`);
      this.sendAttached(clientReqId, exited);
      this.send({ kind: 'terminal.exit', terminalId, exitCode: exited.exitCode });
      return;
    }
    if (mode === 'control' && entry.managed) {
      throw new Error(`managed terminal ${terminalId} is read-only`);
    }

    const existingSecret = entry.attachments.get(attachment.attachmentId);
    if (existingSecret !== undefined && existingSecret !== attachment.attachmentSecret) {
      throw new Error(`terminal attachment ${attachment.attachmentId} is already in use`);
    }
    entry.flushOutput();
    entry.attachments.set(attachment.attachmentId, attachment.attachmentSecret);
    this.cancelReap(entry);

    const controllerChanged =
      mode === 'control' && entry.metadata.controllerAttachmentId !== attachment.attachmentId;
    if (mode === 'control') entry.metadata.controllerAttachmentId = attachment.attachmentId;

    this.sendAttached(clientReqId, entry);
    if (controllerChanged) this.sendController(entry);
  }

  detach(terminalId: string, attachment: TerminalAttachmentCredentials): void {
    const entry = this.terminals.get(terminalId);
    if (!entry || !this.hasAttachment(entry, attachment)) return;
    entry.attachments.delete(attachment.attachmentId);
    if (entry.metadata.controllerAttachmentId === attachment.attachmentId) {
      entry.metadata.controllerAttachmentId = null;
      this.sendController(entry);
    }
    this.scheduleReap(entry);
  }

  /** Spawn an engine-owned terminal (e.g. a workspace script): no `terminal.opened` reply, exempt
   * from detached host-terminal reaping; output/exit use the normal attachment-routed stream. */
  async openManaged(
    opts: PtyOpenOptions,
    onExit?: (exitCode: number | null) => void,
  ): Promise<string> {
    const spawned = await this.spawn(opts, { managed: true, onExit });
    spawned.releaseExit();
    return spawned.terminalId;
  }

  private async spawn(
    opts: PtyOpenOptions,
    owner: {
      sessionId?: SessionId;
      managed?: boolean;
      onExit?: (exitCode: number | null) => void;
      attachment?: TerminalAttachmentCredentials;
    },
  ): Promise<SpawnedTerminal> {
    const terminalId = this.nextTerminalId();
    const wasm = await (this.wasm ??= loadResttyWasm());
    const headless = await createHeadlessTerminal({
      cols: opts.cols,
      rows: opts.rows,
      maxScrollbackBytes: 0,
      replay: false,
      wasm,
    });
    let process: PtyProcess;
    try {
      process = await this.backend.open(terminalId, opts);
    } catch (error) {
      headless.dispose();
      throw error;
    }

    // `backend.open` is async; a `session.stop` may have run its `killBySession` while we awaited,
    // before this terminal was ever registered. Reap it now instead of leaking an orphaned PTY.
    if (owner.sessionId && this.isSessionActive?.(owner.sessionId) === false) {
      process.kill();
      headless.dispose();
      throw new Error(`session ${owner.sessionId} stopped before terminal ${terminalId} opened`);
    }

    const attachments = new Map<string, string>();
    if (owner.attachment) {
      attachments.set(owner.attachment.attachmentId, owner.attachment.attachmentSecret);
    }
    const replay = new TerminalReplayJournal();
    replay.appendResize(opts.cols, opts.rows);
    const entry: TerminalEntry = {
      process,
      headless,
      metadata: {
        terminalId,
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        shell: opts.shell,
        sessionId: owner.sessionId,
        managed: owner.managed === true,
        createdAt: Date.now(),
        controllerAttachmentId: owner.attachment?.attachmentId ?? null,
      },
      attachments,
      replay,
      flushOutput: noop,
      disposed: false,
      sessionId: owner.sessionId,
      managed: owner.managed,
      unsubData: noop,
      unsubExit: noop,
    };
    this.terminals.set(terminalId, entry);

    let pending = '';
    let scheduled = false;
    const flush = (): void => {
      scheduled = false;
      if (pending.length === 0 || entry.disposed) return;
      const data = pending;
      pending = '';
      const event = entry.replay.appendWrite(data);
      this.send({ kind: 'terminal.output', terminalId, seq: event.seq, data });
    };
    entry.flushOutput = flush;

    entry.unsubData = process.onData((data) => {
      pending += data;
      headless.write(data);
      const reply = headless.drainOutput();
      if (reply.length > 0) process.write(reply);
      if (pending.length >= OUTPUT_FLUSH_CAP) {
        flush();
      } else if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    let released = false;
    let pendingExit: { exitCode: number | null } | undefined;
    let exitAnnounced = false;
    const announceExit = (exitCode: number | null): void => {
      if (exitAnnounced) return;
      exitAnnounced = true;
      this.send({ kind: 'terminal.exit', terminalId, exitCode });
      owner.onExit?.(exitCode);
    };
    const unsubExit = process.onExit((exitCode) => {
      if (entry.disposed) return;
      flush();
      this.retainExited(entry, exitCode);
      if (released) announceExit(exitCode);
      else pendingExit = { exitCode };
    });
    if (entry.disposed) unsubExit();
    else entry.unsubExit = unsubExit;
    return {
      terminalId,
      releaseExit() {
        released = true;
        if (!pendingExit) return;
        announceExit(pendingExit.exitCode);
        pendingExit = undefined;
      },
    };
  }

  input(terminalId: string, attachment: TerminalAttachmentCredentials, data: string): void {
    const entry = this.controlledBy(terminalId, attachment);
    entry?.process.write(data);
  }

  resize(
    terminalId: string,
    attachment: TerminalAttachmentCredentials,
    cols: number,
    rows: number,
  ): void {
    const entry = this.controlledBy(terminalId, attachment);
    if (!entry || (entry.metadata.cols === cols && entry.metadata.rows === rows)) return;
    entry.flushOutput();
    entry.metadata.cols = cols;
    entry.metadata.rows = rows;
    entry.headless.resize(cols, rows);
    const event = entry.replay.appendResize(cols, rows);
    this.send({ kind: 'terminal.resized', terminalId, seq: event.seq, cols, rows });
    entry.process.resize(cols, rows);
  }

  /** Request termination; cleanup follows from the resulting exit event. */
  close(terminalId: string, attachment: TerminalAttachmentCredentials): void {
    this.controlledBy(terminalId, attachment)?.process.kill();
  }

  /** Stop an engine-owned terminal; client capabilities can never call this path. */
  closeManaged(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (entry?.managed) entry.process.kill();
  }

  /** Reap every terminal owned by a session (called when the session stops). */
  killBySession(sessionId: SessionId): void {
    for (const entry of this.terminals.values()) {
      if (entry.sessionId === sessionId) entry.process.kill();
    }
  }

  /** Tear down all terminals and the backend (engine shutdown). */
  closeAll(): void {
    for (const entry of this.terminals.values()) {
      entry.disposed = true;
      this.cancelReap(entry);
      entry.unsubData();
      entry.unsubExit();
      entry.headless.dispose();
      entry.process.kill();
    }
    this.terminals.clear();
    for (const entry of this.exitedTerminals.values()) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    }
    this.exitedTerminals.clear();
    this.backend.shutdown();
  }

  private retainExited(entry: TerminalEntry, exitCode: number | null): void {
    const terminalId = entry.metadata.terminalId;
    entry.disposed = true;
    this.cancelReap(entry);
    entry.unsubData();
    entry.unsubExit();
    entry.headless.dispose();
    this.terminals.delete(terminalId);
    const exited: ExitedTerminalEntry = {
      metadata: { ...entry.metadata, controllerAttachmentId: null },
      replay: entry.replay,
      exitCode,
    };
    exited.expiryTimer = setTimeout(() => {
      exited.expiryTimer = undefined;
      if (this.exitedTerminals.get(terminalId) === exited) {
        this.exitedTerminals.delete(terminalId);
      }
    }, EXITED_TERMINAL_RETENTION_MS);
    this.exitedTerminals.set(terminalId, exited);
  }

  private controlledBy(
    terminalId: string,
    attachment: TerminalAttachmentCredentials,
  ): TerminalEntry | undefined {
    const entry = this.terminals.get(terminalId);
    return entry?.metadata.controllerAttachmentId === attachment.attachmentId &&
      this.hasAttachment(entry, attachment)
      ? entry
      : undefined;
  }

  private hasAttachment(entry: TerminalEntry, attachment: TerminalAttachmentCredentials): boolean {
    return entry.attachments.get(attachment.attachmentId) === attachment.attachmentSecret;
  }

  private metadata(entry: TerminalRecord): TerminalMetadata {
    return { ...entry.metadata };
  }

  private sendAttached(clientReqId: string, entry: TerminalRecord): void {
    this.send({
      kind: 'terminal.attached',
      replyTo: clientReqId,
      terminal: this.metadata(entry),
      replay: entry.replay.snapshot(),
      cutoffSeq: entry.replay.cutoffSeq,
      truncated: entry.replay.truncated,
    });
  }

  private sendController(entry: TerminalEntry): void {
    this.send({
      kind: 'terminal.controller.changed',
      terminalId: entry.metadata.terminalId,
      controllerAttachmentId: entry.metadata.controllerAttachmentId,
    });
  }

  private isHostTerminal(entry: TerminalEntry): boolean {
    return entry.sessionId === undefined && entry.managed !== true;
  }

  private scheduleReap(entry: TerminalEntry): void {
    if (!this.isHostTerminal(entry) || entry.attachments.size > 0 || entry.reapTimer) return;
    entry.reapTimer = setTimeout(() => {
      entry.reapTimer = undefined;
      if (entry.attachments.size === 0 && !entry.disposed) entry.process.kill();
    }, HOST_TERMINAL_REAP_DELAY_MS);
  }

  private cancelReap(entry: TerminalEntry): void {
    if (!entry.reapTimer) return;
    clearTimeout(entry.reapTimer);
    entry.reapTimer = undefined;
  }

  private nextTerminalId(): string {
    this.seq += 1;
    return `term-${Date.now().toString(36)}-${this.seq.toString(36)}`;
  }

  private send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }
}
