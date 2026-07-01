import type { SessionId, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from './pty-backend';

interface TerminalEntry {
  process: PtyProcess;
  /** Set for agent-owned terminals so `killBySession` can reap them when the session stops. */
  sessionId?: SessionId;
  unsubData: Unsubscribe;
  unsubExit: Unsubscribe;
}

/**
 * TerminalService: owns the host's live terminals and bridges a {@link PtyBackend} to the `terminal.*`
 * wire messages. Sits beside `HistoryService` in the {@link Engine}. Output is coalesced per microtask
 * so a full-speed PTY doesn't emit one Zod-validated, broadcast wire message per tiny write.
 */
export class TerminalService {
  private readonly terminals = new Map<string, TerminalEntry>();
  private seq = 0;

  constructor(
    private readonly backend: PtyBackend,
    private readonly transport: Transport,
  ) {}

  /** Spawn a terminal, reply `terminal.opened`, then stream `terminal.output` / `terminal.exit`. */
  async open(clientReqId: string, opts: PtyOpenOptions & { sessionId?: SessionId }): Promise<void> {
    const terminalId = this.nextTerminalId();
    const process = await this.backend.open(terminalId, opts);

    let pending = '';
    let scheduled = false;
    const flush = (): void => {
      scheduled = false;
      if (pending.length === 0) return;
      const data = pending;
      pending = '';
      this.send({ kind: 'terminal.output', terminalId, data });
    };

    const unsubData = process.onData((data) => {
      pending += data;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    const unsubExit = process.onExit((exitCode) => {
      flush();
      this.dispose(terminalId);
      this.send({ kind: 'terminal.exit', terminalId, exitCode });
    });

    this.terminals.set(terminalId, { process, sessionId: opts.sessionId, unsubData, unsubExit });
    this.send({ kind: 'terminal.opened', replyTo: clientReqId, terminalId });
  }

  input(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.process.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.terminals.get(terminalId)?.process.resize(cols, rows);
  }

  /** Request termination; cleanup follows from the resulting exit event. */
  close(terminalId: string): void {
    this.terminals.get(terminalId)?.process.kill();
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
      entry.unsubData();
      entry.unsubExit();
      entry.process.kill();
    }
    this.terminals.clear();
    this.backend.shutdown();
  }

  private dispose(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) return;
    entry.unsubData();
    entry.unsubExit();
    this.terminals.delete(terminalId);
  }

  private nextTerminalId(): string {
    this.seq += 1;
    return `term-${Date.now().toString(36)}-${this.seq.toString(36)}`;
  }

  private send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }
}
