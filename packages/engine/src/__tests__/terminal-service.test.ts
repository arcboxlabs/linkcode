import type { SessionId, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '../pty-backend';
import { TerminalService } from '../terminal-service';

/** A PTY that loops written data straight back as output, and exits with code 0 when killed. */
class FakePtyProcess implements PtyProcess {
  killed = false;
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  readonly grants: number[] = [];
  private dataCbs: Array<(d: string) => void> = [];
  private exitCbs: Array<(c: number | null) => void> = [];

  onData(cb: (d: string) => void): Unsubscribe {
    this.dataCbs.push(cb);
    return () => {
      this.dataCbs = this.dataCbs.filter((c) => c !== cb);
    };
  }
  onExit(cb: (c: number | null) => void): Unsubscribe {
    this.exitCbs.push(cb);
    return () => {
      this.exitCbs = this.exitCbs.filter((c) => c !== cb);
    };
  }
  write(data: string): void {
    this.writes.push(data);
    for (const cb of this.dataCbs) cb(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  grantRead(bytes: number): void {
    this.grants.push(bytes);
  }
  kill(): void {
    this.killed = true;
    for (const cb of this.exitCbs) cb(0);
  }

  emitData(data: string): void {
    for (const cb of this.dataCbs) cb(data);
  }

  emitExit(exitCode: number | null): void {
    for (const cb of this.exitCbs) cb(exitCode);
  }
}

class FakePtyBackend implements PtyBackend {
  shutdownCalled = false;
  readonly opened: FakePtyProcess[] = [];

  open(_terminalId: string, _opts: PtyOpenOptions): Promise<PtyProcess> {
    const process = new FakePtyProcess();
    this.opened.push(process);
    return Promise.resolve(process);
  }
  shutdown(): void {
    this.shutdownCalled = true;
  }
}

class SyncReplayPtyProcess extends FakePtyProcess {
  override onData(cb: (data: string) => void): Unsubscribe {
    const unsub = super.onData(cb);
    cb('ready\r\n');
    return unsub;
  }
}

class SyncReplayPtyBackend extends FakePtyBackend {
  override open(_terminalId: string, _opts: PtyOpenOptions): Promise<PtyProcess> {
    const process = new SyncReplayPtyProcess();
    this.opened.push(process);
    return Promise.resolve(process);
  }
}

class SyncExitPtyProcess extends SyncReplayPtyProcess {
  override onExit(cb: (exitCode: number | null) => void): Unsubscribe {
    cb(7);
    return noop;
  }
}

class SyncExitPtyBackend extends FakePtyBackend {
  override open(_terminalId: string, _opts: PtyOpenOptions): Promise<PtyProcess> {
    const process = new SyncExitPtyProcess();
    this.opened.push(process);
    return Promise.resolve(process);
  }
}

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

/** Let the microtask-scheduled output flush run. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function openedId(sent: WirePayload[], replyTo: string): string {
  const opened = sent.find((p) => p.kind === 'terminal.opened' && p.replyTo === replyTo);
  if (opened?.kind !== 'terminal.opened') throw new Error(`no terminal.opened for ${replyTo}`);
  return opened.terminal.terminalId;
}

const opts: PtyOpenOptions = { cols: 80, rows: 24 };
const desktop = { attachmentId: 'desktop', attachmentSecret: 'd'.repeat(32) };
const mobile = { attachmentId: 'mobile', attachmentSecret: 'm'.repeat(32) };

describe('TerminalService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replies terminal.opened and coalesces echoed input into one terminal.output', async () => {
    const { transport, sent } = recordingTransport();
    const service = new TerminalService(new FakePtyBackend(), transport);

    await service.open('req-1', opts, desktop);
    const id = openedId(sent, 'req-1');

    // Two synchronous writes must collapse to a single output frame, not one per write.
    service.input(id, desktop, 'a');
    service.input(id, desktop, 'b');
    await tick();

    const outputs = sent.filter((p) => p.kind === 'terminal.output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      kind: 'terminal.output',
      terminalId: id,
      seq: 2,
      data: 'ab',
    });
  });

  it('includes output delivered during initial PTY subscription in the opened replay', async () => {
    const { transport, sent } = recordingTransport();
    const service = new TerminalService(new SyncReplayPtyBackend(), transport);

    await service.open('req-1', opts, desktop);

    expect(sent.find((p) => p.kind === 'terminal.opened')).toMatchObject({
      kind: 'terminal.opened',
      cutoffSeq: 2,
      truncated: false,
      replay: [
        { type: 'resize', seq: 1, cols: 80, rows: 24 },
        { type: 'write', seq: 2, data: 'ready\r\n' },
      ],
    });
  });

  it('opens before reporting a synchronous exit, then retains a view-only replay for 60 seconds', async () => {
    vi.useFakeTimers();
    const { transport, sent } = recordingTransport();
    const backend = new SyncExitPtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', opts, desktop);
    const id = openedId(sent, 'req-open');
    const openedIndex = sent.findIndex((payload) => payload.kind === 'terminal.opened');
    const exitIndex = sent.findIndex((payload) => payload.kind === 'terminal.exit');

    expect(openedIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(openedIndex);
    expect(sent[openedIndex]).toMatchObject({
      kind: 'terminal.opened',
      terminal: { terminalId: id, controllerAttachmentId: null },
      replay: [
        { type: 'resize', seq: 1, cols: 80, rows: 24 },
        { type: 'write', seq: 2, data: 'ready\r\n' },
      ],
      cutoffSeq: 2,
      truncated: false,
    });

    service.list('req-list');
    expect(sent.find((payload) => payload.kind === 'terminal.listed')).toMatchObject({
      terminals: [],
    });

    const attachIndex = sent.length;
    service.attach('req-view', id, mobile, 'view');
    expect(sent.slice(attachIndex)).toMatchObject([
      {
        kind: 'terminal.attached',
        terminal: { terminalId: id, controllerAttachmentId: null },
        replay: [
          { type: 'resize', seq: 1, cols: 80, rows: 24 },
          { type: 'write', seq: 2, data: 'ready\r\n' },
        ],
      },
      { kind: 'terminal.exit', terminalId: id, exitCode: 7 },
    ]);
    expect(() => service.attach('req-control', id, mobile, 'control')).toThrow('has exited');

    service.input(id, desktop, 'ignored');
    service.resize(id, desktop, 100, 30);
    service.close(id, desktop);
    expect(backend.opened[0].writes).toEqual([]);
    expect(backend.opened[0].resizes).toEqual([]);
    expect(backend.opened[0].killed).toBe(false);

    await vi.advanceTimersByTimeAsync(59999);
    service.attach('req-last-view', id, mobile, 'view');
    await vi.advanceTimersByTimeAsync(1);
    expect(() => service.attach('req-expired', id, mobile, 'view')).toThrow('is not running');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lists metadata, attaches viewers, and grants exclusive control without echoing secrets', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', { ...opts, cwd: '/workspace' }, desktop);
    const id = openedId(sent, 'req-open');
    service.list('req-list');
    service.attach('req-view', id, mobile, 'view');

    service.input(id, mobile, 'ignored');
    service.input(id, { ...desktop, attachmentSecret: 'x'.repeat(32) }, 'ignored');
    service.input(id, desktop, 'desktop');
    expect(backend.opened[0].writes).toEqual(['desktop']);

    service.attach('req-control', id, mobile, 'control');
    service.input(id, desktop, 'ignored');
    service.input(id, mobile, 'mobile');
    service.resize(id, mobile, 100, 30);

    expect(backend.opened[0].writes).toEqual(['desktop', 'mobile']);
    expect(backend.opened[0].resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(sent).toContainEqual({
      kind: 'terminal.resized',
      terminalId: id,
      seq: 4,
      cols: 100,
      rows: 30,
    });
    expect(
      sent.flatMap((payload) =>
        payload.kind === 'terminal.controller.changed' ? [payload.controllerAttachmentId] : [],
      ),
    ).toEqual([desktop.attachmentId, mobile.attachmentId]);
    expect(sent).toContainEqual({
      kind: 'terminal.listed',
      replyTo: 'req-list',
      terminals: [
        expect.objectContaining({ terminalId: id, cwd: '/workspace', cols: 80, rows: 24 }),
      ],
    });
    expect(JSON.stringify(sent)).not.toContain(desktop.attachmentSecret);
    expect(JSON.stringify(sent)).not.toContain(mobile.attachmentSecret);
  });

  it('replays the spawn size before output to a late attach without broadcasting it', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', opts, desktop);
    const id = openedId(sent, 'req-open');
    backend.opened[0].emitData('history');
    await tick();

    expect(sent.some((payload) => payload.kind === 'terminal.resized')).toBe(false);
    service.attach('req-late', id, mobile, 'view');
    expect(sent.find((payload) => payload.kind === 'terminal.attached')).toMatchObject({
      cutoffSeq: 2,
      replay: [
        { type: 'resize', seq: 1, cols: 80, rows: 24 },
        { type: 'write', seq: 2, data: 'history' },
      ],
    });
  });

  it('returns an ordered write/resize replay and marks a bounded journal as truncated', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', opts, desktop);
    const id = openedId(sent, 'req-open');
    backend.opened[0].emitData('before');
    service.resize(id, desktop, 90, 25);
    backend.opened[0].emitData('after');
    await tick();
    service.attach('req-replay', id, mobile, 'view');

    const attached = sent.find((p) => p.kind === 'terminal.attached' && p.replyTo === 'req-replay');
    expect(attached).toMatchObject({
      kind: 'terminal.attached',
      terminal: { controllerAttachmentId: desktop.attachmentId },
      cutoffSeq: 4,
      truncated: false,
      replay: [
        { type: 'resize', seq: 1, cols: 80, rows: 24 },
        { type: 'write', seq: 2, data: 'before' },
        { type: 'resize', seq: 3, cols: 90, rows: 25 },
        { type: 'write', seq: 4, data: 'after' },
      ],
    });

    backend.opened[0].emitData('x'.repeat(10 * 1024 * 1024 + 1));
    service.attach('req-truncated', id, mobile, 'view');
    const truncated = sent.find(
      (p) => p.kind === 'terminal.attached' && p.replyTo === 'req-truncated',
    );
    expect(truncated).toMatchObject({ kind: 'terminal.attached', truncated: true });
  });

  it('flushes final output before exit and is the sole terminal-reply authority', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', opts, desktop);
    const id = openedId(sent, 'req-open');
    backend.opened[0].emitData('\u{1B}[6n');
    expect(backend.opened[0].writes).toEqual(['\u{1B}[1;1R']);
    backend.opened[0].emitData('tail');
    backend.opened[0].emitExit(7);

    const outputIndex = sent.findIndex((p) => p.kind === 'terminal.output' && p.terminalId === id);
    const exitIndex = sent.findIndex((p) => p.kind === 'terminal.exit' && p.terminalId === id);
    expect(outputIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(outputIndex);
  });

  it('detaches without closing, cancels reap on reattach, and only lets the controller close', async () => {
    vi.useFakeTimers();
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-open', opts, desktop);
    const id = openedId(sent, 'req-open');
    service.detach(id, desktop);
    await vi.advanceTimersByTimeAsync(59000);
    expect(backend.opened[0].killed).toBe(false);

    service.attach('req-attach', id, mobile, 'view');
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.opened[0].killed).toBe(false);
    service.detach(id, mobile);
    await vi.advanceTimersByTimeAsync(60000);
    expect(backend.opened[0].killed).toBe(true);

    await service.open('req-second', opts, desktop);
    const secondId = openedId(sent, 'req-second');
    service.attach('req-view', secondId, mobile, 'view');
    service.close(secondId, mobile);
    expect(backend.opened[1].killed).toBe(false);
    service.attach('req-control', secondId, mobile, 'control');
    service.close(secondId, mobile);
    expect(backend.opened[1].killed).toBe(true);
  });

  it('emits terminal.exit and stops routing input after the terminal exits', async () => {
    const { transport, sent } = recordingTransport();
    const service = new TerminalService(new FakePtyBackend(), transport);

    await service.open('req-1', opts, desktop);
    const id = openedId(sent, 'req-1');

    service.close(id, desktop);
    expect(sent).toContainEqual({ kind: 'terminal.exit', terminalId: id, exitCode: 0 });

    // Input to an exited terminal is a no-op — no further output.
    service.input(id, desktop, 'x');
    await tick();
    expect(sent.filter((p) => p.kind === 'terminal.output')).toHaveLength(0);
  });

  it('killBySession reaps only terminals owned by that session', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-a', { ...opts, sessionId: 's1' as SessionId }, desktop);
    await service.open('req-b', { ...opts, sessionId: 's2' as SessionId }, mobile);
    const idA = openedId(sent, 'req-a');

    service.killBySession('s1' as SessionId);

    expect(backend.opened[0].killed).toBe(true);
    expect(backend.opened[1].killed).toBe(false);
    const exits = sent.filter((p) => p.kind === 'terminal.exit');
    expect(exits).toEqual([{ kind: 'terminal.exit', terminalId: idA, exitCode: 0 }]);
  });

  it('closeAll kills every terminal and shuts the backend down silently', async () => {
    vi.useFakeTimers();
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-a', opts, desktop);
    await service.open('req-b', opts, mobile);
    service.close(openedId(sent, 'req-a'), desktop);
    const exitsBeforeShutdown = sent.filter((payload) => payload.kind === 'terminal.exit').length;
    expect(vi.getTimerCount()).toBe(1);

    service.closeAll();

    expect(backend.opened.every((p) => p.killed)).toBe(true);
    expect(backend.shutdownCalled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // Shutdown unsubscribes before killing, so it adds no terminal.exit broadcasts.
    expect(sent.filter((p) => p.kind === 'terminal.exit')).toHaveLength(exitsBeforeShutdown);
  });
});
