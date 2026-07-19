import type {
  SessionId,
  TerminalAttachmentCredentials,
  TerminalMetadata,
  WirePayload,
} from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import type { ResttyHeadlessTerminal } from 'restty/headless';
import { createHeadlessTerminal } from 'restty/headless';
import type { ResttyWasm } from 'restty/internal';
import { loadResttyWasm } from 'restty/internal';
import { TERMINAL_SIDECAR_WINDOW_BYTES, TerminalFlow } from './flow';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from './pty-backend';
import { TerminalReplayJournal } from './replay';

export interface TerminalEntry {
  metadata: TerminalMetadata;
  replay: TerminalReplayJournal;
  process: PtyProcess;
  headless: ResttyHeadlessTerminal;
  attachments: Map<string, string>;
  flow: TerminalFlow;
  flushOutput: () => void;
  reapTimer?: ReturnType<typeof setTimeout>;
  disposed: boolean;
  sessionId?: SessionId;
  managed?: boolean;
  unsubData: Unsubscribe;
  unsubExit: Unsubscribe;
}

interface TerminalOwner {
  sessionId?: SessionId;
  managed?: boolean;
  onExit?: (exitCode: number | null) => void;
  attachment?: TerminalAttachmentCredentials;
}

interface TerminalSpawnerHooks {
  register: (entry: TerminalEntry) => void;
  retainExited: (
    entry: TerminalEntry,
    exitCode: number | null,
    finishExit: (force: boolean) => void,
  ) => void;
  send: (payload: WirePayload) => void;
}

const OUTPUT_FLUSH_CAP = 256 * 1024;

export class TerminalSpawner {
  private wasm?: Promise<ResttyWasm>;

  constructor(
    private readonly backend: PtyBackend,
    private readonly hooks: TerminalSpawnerHooks,
    private readonly isSessionActive?: (sessionId: SessionId) => boolean,
  ) {}

  async spawn(terminalId: string, opts: PtyOpenOptions, owner: TerminalOwner) {
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
      process = await this.backend.open(terminalId, {
        ...opts,
        credit: TERMINAL_SIDECAR_WINDOW_BYTES,
      });
    } catch (error) {
      headless.dispose();
      throw error;
    }

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
    const flow = new TerminalFlow(replay, {
      deliver: (event) => {
        if (event.type === 'write') {
          this.hooks.send({
            kind: 'terminal.output',
            terminalId,
            seq: event.seq,
            data: event.data,
          });
        } else {
          this.hooks.send({
            kind: 'terminal.resized',
            terminalId,
            seq: event.seq,
            cols: event.cols,
            rows: event.rows,
          });
        }
      },
      grantRead: (bytes) => process.grantRead(bytes),
    });
    const entry: TerminalEntry = {
      process,
      headless,
      flow,
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
    this.hooks.register(entry);

    let pending = '';
    let scheduled = false;
    const flush = (): void => {
      scheduled = false;
      if (pending.length === 0 || entry.disposed) return;
      const data = pending;
      pending = '';
      entry.replay.appendWrite(data);
      flow.pump();
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
    let exitAnnounced = false;
    let exitResult: { exitCode: number | null } | undefined;
    // Wait for both the open reply and journal drain to preserve output-before-exit ordering.
    const finishExit = (force: boolean): void => {
      if (exitAnnounced || !exitResult || !released) return;
      if (!force && !flow.drained) return;
      exitAnnounced = true;
      this.hooks.send({ kind: 'terminal.exit', terminalId, exitCode: exitResult.exitCode });
      owner.onExit?.(exitResult.exitCode);
    };
    const unsubExit = process.onExit((exitCode) => {
      if (entry.disposed) return;
      flush();
      exitResult = { exitCode };
      this.hooks.retainExited(entry, exitCode, finishExit);
      finishExit(false);
    });
    if (entry.disposed) unsubExit();
    else entry.unsubExit = unsubExit;
    return {
      terminalId,
      releaseExit() {
        released = true;
        finishExit(false);
      },
    };
  }
}
