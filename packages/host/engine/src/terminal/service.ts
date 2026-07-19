import type {
  SessionId,
  TerminalAttachmentCredentials,
  TerminalAttachmentMode,
  TerminalMetadata,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { TerminalFlow } from './flow';
import type { PtyBackend, PtyOpenOptions } from './pty-backend';
import type { TerminalReplayJournal } from './replay';
import type { TerminalEntry } from './spawner';
import { TerminalSpawner } from './spawner';

interface TerminalRecord {
  metadata: TerminalMetadata;
  replay: TerminalReplayJournal;
}

interface ExitedTerminalEntry extends TerminalRecord {
  exitCode: number | null;
  /** Live flow + attachments carry over so a windowed drain can finish after the PTY exits. */
  flow: TerminalFlow;
  attachments: Map<string, string>;
  /** Announce `terminal.exit` once the drain (or the retention backstop, force=true) allows it. */
  finishExit: (force: boolean) => void;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

const HOST_TERMINAL_REAP_DELAY_MS = 60000;
const EXITED_TERMINAL_RETENTION_MS = 60000;

/**
 * Owns the host's live terminals and short-lived exited replay tombstones, bridging a
 * {@link PtyBackend} to the `terminal.*` wire. Output is coalesced per microtask so a full-speed
 * PTY doesn't emit one Zod-validated wire message per tiny write, journaled, and delivered through
 * a per-terminal {@link TerminalFlow} window clamped by client `terminal.ack`s — consumed bytes
 * flow back to the PTY as read credit, so a flooding process blocks in the kernel (CODE-231).
 */
export class TerminalService {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly exitedTerminals = new Map<string, ExitedTerminalEntry>();
  private readonly spawner: TerminalSpawner;
  private seq = 0;

  constructor(
    private readonly backend: PtyBackend,
    private readonly transport: Transport,
    /** Liveness check for the owning session; lets `open` bail if the session stopped mid-spawn. */
    isSessionActive?: (sessionId: SessionId) => boolean,
  ) {
    this.spawner = new TerminalSpawner(
      this.backend,
      {
        register: (entry) => this.terminals.set(entry.metadata.terminalId, entry),
        retainExited: (entry, exitCode, finishExit) =>
          this.retainExited(entry, exitCode, finishExit),
        send: (payload) => this.send(payload),
      },
      isSessionActive,
    );
  }

  /** Spawn a terminal with its initial controller already attached. */
  async open(
    clientReqId: string,
    opts: PtyOpenOptions & { sessionId?: SessionId },
    attachment: TerminalAttachmentCredentials,
  ): Promise<void> {
    const spawned = await this.spawner.spawn(this.nextTerminalId(), opts, {
      sessionId: opts.sessionId,
      attachment,
    });
    const entry = this.terminals.get(spawned.terminalId);
    entry?.flushOutput();
    const record = entry ?? this.exitedTerminals.get(spawned.terminalId);
    if (!record) throw new Error(`terminal ${spawned.terminalId} disappeared while opening`);
    try {
      // A live terminal replies with the flow snapshot (baseline for this attachment's acks); a
      // terminal that already exited mid-open has no live stream, so it gets the full journal.
      const attach = entry ? entry.flow.attach(attachment.attachmentId) : undefined;
      this.send({
        kind: 'terminal.opened',
        replyTo: clientReqId,
        terminal: this.metadata(record),
        replay: attach?.replay ?? record.replay.snapshot(),
        cutoffSeq: attach?.cutoffSeq ?? record.replay.cutoffSeq,
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

    const flowAttach = entry.flow.attach(attachment.attachmentId);
    this.send({
      kind: 'terminal.attached',
      replyTo: clientReqId,
      terminal: this.metadata(entry),
      replay: flowAttach.replay,
      cutoffSeq: flowAttach.cutoffSeq,
      truncated: entry.replay.truncated,
    });
    if (controllerChanged) this.sendController(entry);
  }

  detach(terminalId: string, attachment: TerminalAttachmentCredentials): void {
    const entry = this.terminals.get(terminalId);
    if (entry) {
      if (!this.hasAttachment(entry, attachment)) return;
      entry.attachments.delete(attachment.attachmentId);
      entry.flow.detach(attachment.attachmentId);
      if (entry.metadata.controllerAttachmentId === attachment.attachmentId) {
        entry.metadata.controllerAttachmentId = null;
        this.sendController(entry);
      }
      this.scheduleReap(entry);
      return;
    }
    // A detach during a windowed post-exit drain unblocks it (connection loss becomes detach).
    const exited = this.exitedTerminals.get(terminalId);
    if (!exited || !this.hasAttachment(exited, attachment)) return;
    exited.attachments.delete(attachment.attachmentId);
    exited.flow.detach(attachment.attachmentId);
    exited.finishExit(false);
  }

  /** Apply a client's cumulative output ack: frees its delivery window, pumps held output, and
   * returns consumed journal bytes to the PTY as read credit. */
  ack(terminalId: string, attachment: TerminalAttachmentCredentials, acked: number): void {
    const entry = this.terminals.get(terminalId);
    if (entry) {
      if (this.hasAttachment(entry, attachment)) entry.flow.ack(attachment.attachmentId, acked);
      return;
    }
    const exited = this.exitedTerminals.get(terminalId);
    if (!exited || !this.hasAttachment(exited, attachment)) return;
    exited.flow.ack(attachment.attachmentId, acked);
    exited.finishExit(false);
  }

  /** Spawn an engine-owned terminal (e.g. a workspace script): no `terminal.opened` reply, exempt
   * from detached host-terminal reaping; output/exit use the normal attachment-routed stream. */
  async openManaged(
    opts: PtyOpenOptions,
    onExit?: (exitCode: number | null) => void,
  ): Promise<string> {
    const spawned = await this.spawner.spawn(this.nextTerminalId(), opts, {
      managed: true,
      onExit,
    });
    spawned.releaseExit();
    return spawned.terminalId;
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
    entry.replay.appendResize(cols, rows);
    // The resized broadcast rides the delivery cursor so viewers see it ordered with output.
    entry.flow.pump();
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

  private retainExited(
    entry: TerminalEntry,
    exitCode: number | null,
    finishExit: (force: boolean) => void,
  ): void {
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
      flow: entry.flow,
      attachments: entry.attachments,
      finishExit,
      exitCode,
    };
    exited.expiryTimer = setTimeout(() => {
      exited.expiryTimer = undefined;
      if (this.exitedTerminals.get(terminalId) === exited) {
        // Retention over: tell any straggling viewer it exited even if its drain never finished.
        exited.finishExit(true);
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

  private hasAttachment(
    entry: { attachments: Map<string, string> },
    attachment: TerminalAttachmentCredentials,
  ): boolean {
    return entry.attachments.get(attachment.attachmentId) === attachment.attachmentSecret;
  }

  private metadata(entry: TerminalRecord): TerminalMetadata {
    return { ...entry.metadata };
  }

  /** Attach reply for an exited terminal: no live stream follows, so it gets the full journal. */
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
