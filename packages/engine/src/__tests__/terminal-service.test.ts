import type { SessionId, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxact/noop';
import { describe, expect, it } from 'vitest';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '../pty-backend';
import { TerminalService } from '../terminal-service';

/** A PTY that loops written data straight back as output, and exits with code 0 when killed. */
class FakePtyProcess implements PtyProcess {
  killed = false;
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
    for (const cb of this.dataCbs) cb(data);
  }
  resize(): void {
    /* fake terminal: resize has no observable effect in these tests */
  }
  kill(): void {
    this.killed = true;
    for (const cb of this.exitCbs) cb(0);
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
  return opened.terminalId;
}

const opts: PtyOpenOptions = { cols: 80, rows: 24 };

describe('TerminalService', () => {
  it('replies terminal.opened and coalesces echoed input into one terminal.output', async () => {
    const { transport, sent } = recordingTransport();
    const service = new TerminalService(new FakePtyBackend(), transport);

    await service.open('req-1', opts);
    const id = openedId(sent, 'req-1');

    // Two synchronous writes must collapse to a single output frame, not one per write.
    service.input(id, 'a');
    service.input(id, 'b');
    await tick();

    const outputs = sent.filter((p) => p.kind === 'terminal.output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ kind: 'terminal.output', terminalId: id, data: 'ab' });
  });

  it('emits terminal.exit and stops routing input after the terminal exits', async () => {
    const { transport, sent } = recordingTransport();
    const service = new TerminalService(new FakePtyBackend(), transport);

    await service.open('req-1', opts);
    const id = openedId(sent, 'req-1');

    service.close(id);
    expect(sent).toContainEqual({ kind: 'terminal.exit', terminalId: id, exitCode: 0 });

    // Input to an exited terminal is a no-op — no further output.
    service.input(id, 'x');
    await tick();
    expect(sent.filter((p) => p.kind === 'terminal.output')).toHaveLength(0);
  });

  it('killBySession reaps only terminals owned by that session', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-a', { ...opts, sessionId: 's1' as SessionId });
    await service.open('req-b', { ...opts, sessionId: 's2' as SessionId });
    const idA = openedId(sent, 'req-a');

    service.killBySession('s1' as SessionId);

    expect(backend.opened[0].killed).toBe(true);
    expect(backend.opened[1].killed).toBe(false);
    const exits = sent.filter((p) => p.kind === 'terminal.exit');
    expect(exits).toEqual([{ kind: 'terminal.exit', terminalId: idA, exitCode: 0 }]);
  });

  it('closeAll kills every terminal and shuts the backend down silently', async () => {
    const { transport, sent } = recordingTransport();
    const backend = new FakePtyBackend();
    const service = new TerminalService(backend, transport);

    await service.open('req-a', opts);
    await service.open('req-b', opts);

    service.closeAll();

    expect(backend.opened.every((p) => p.killed)).toBe(true);
    expect(backend.shutdownCalled).toBe(true);
    // Shutdown unsubscribes before killing, so no terminal.exit is broadcast.
    expect(sent.filter((p) => p.kind === 'terminal.exit')).toHaveLength(0);
  });
});
