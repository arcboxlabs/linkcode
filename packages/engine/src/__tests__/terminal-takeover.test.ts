import type { WireMessage } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage, Listeners } from '@linkcode/transport';
import { Hub } from '@linkcode/transport/server';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../engine';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '../pty-backend';

class PeerTransport implements Transport {
  readonly sent: WireMessage[] = [];
  private readonly inbound = new Listeners<WireMessage>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: WireMessage): void {
    this.sent.push(message);
  }

  onMessage(cb: (message: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(): Unsubscribe {
    return noop;
  }

  close = noop;

  emit(message: WireMessage): void {
    this.inbound.emit(message);
  }
}

class EchoPty implements PtyProcess {
  readonly writes: string[] = [];
  killed = false;
  private readonly data = new Listeners<string>();
  private readonly exit = new Listeners<number | null>();

  onData(cb: (data: string) => void): Unsubscribe {
    return this.data.add(cb);
  }

  onExit(cb: (exitCode: number | null) => void): Unsubscribe {
    return this.exit.add(cb);
  }

  write(data: string): void {
    this.writes.push(data);
    this.data.emit(data);
  }

  resize = noop;

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.exit.emit(0);
  }

  output(data: string): void {
    this.data.emit(data);
  }
}

class EchoPtyBackend implements PtyBackend {
  process: EchoPty | null = null;

  open(_terminalId: string, _opts: PtyOpenOptions): Promise<PtyProcess> {
    this.process = new EchoPty();
    return Promise.resolve(this.process);
  }

  shutdown = noop;
}

const desktopAttachment = {
  attachmentId: 'desktop-attachment',
  attachmentSecret: 'desktop-secret'.padEnd(32, '-'),
};
const mobileAttachment = {
  attachmentId: 'mobile-attachment',
  attachmentSecret: 'mobile-secret'.padEnd(32, '-'),
};

function payloads(peer: PeerTransport) {
  return peer.sent.map((message) => message.payload);
}

describe('terminal takeover through Hub and Engine', () => {
  it('replays to a late mobile controller and keeps it live after desktop disconnects', async () => {
    const hub = new Hub();
    const backend = new EchoPtyBackend();
    const engine = new Engine(hub, { ptyBackend: backend });
    const desktop = new PeerTransport();
    const mobile = new PeerTransport();
    hub.addConnection(desktop);
    hub.addConnection(mobile);
    await engine.start();

    desktop.emit(
      createWireMessage({
        kind: 'terminal.open',
        clientReqId: 'desktop-open',
        opts: { cols: 80, rows: 24 },
        ...desktopAttachment,
      }),
    );
    await vi.waitFor(() => {
      expect(payloads(desktop).some((payload) => payload.kind === 'terminal.opened')).toBe(true);
    });
    const opened = payloads(desktop).find((payload) => payload.kind === 'terminal.opened');
    if (opened?.kind !== 'terminal.opened') throw new Error('terminal did not open');
    const terminalId = opened.terminal.terminalId;

    backend.process?.output('history\r\n');
    await vi.waitFor(() => {
      expect(payloads(desktop).some((payload) => payload.kind === 'terminal.output')).toBe(true);
    });
    expect(payloads(mobile)).toEqual([]);

    mobile.emit(
      createWireMessage({
        kind: 'terminal.attach',
        clientReqId: 'mobile-attach',
        terminalId,
        mode: 'control',
        ...mobileAttachment,
      }),
    );
    await vi.waitFor(() => {
      const attached = payloads(mobile).find((payload) => payload.kind === 'terminal.attached');
      expect(attached).toMatchObject({
        kind: 'terminal.attached',
        replay: [
          { type: 'resize', seq: 1, cols: 80, rows: 24 },
          { type: 'write', seq: 2, data: 'history\r\n' },
        ],
        cutoffSeq: 2,
      });
    });

    mobile.emit(
      createWireMessage({
        kind: 'terminal.input',
        terminalId,
        data: 'mobile input',
        ...mobileAttachment,
      }),
    );
    await vi.waitFor(() => expect(backend.process?.writes).toContain('mobile input'));
    await vi.waitFor(() => {
      expect(
        payloads(desktop).some(
          (payload) => payload.kind === 'terminal.output' && payload.data === 'mobile input',
        ),
      ).toBe(true);
      expect(
        payloads(mobile).some(
          (payload) => payload.kind === 'terminal.output' && payload.data === 'mobile input',
        ),
      ).toBe(true);
    });

    const writesBeforeDesktopInput = backend.process?.writes.length;
    desktop.emit(
      createWireMessage({
        kind: 'terminal.input',
        terminalId,
        data: 'stale desktop input',
        ...desktopAttachment,
      }),
    );
    await Promise.resolve();
    expect(backend.process?.writes).toHaveLength(writesBeforeDesktopInput ?? 0);

    hub.removeConnection(desktop);
    mobile.emit(
      createWireMessage({
        kind: 'terminal.input',
        terminalId,
        data: 'after desktop disconnect',
        ...mobileAttachment,
      }),
    );
    await vi.waitFor(() => expect(backend.process?.writes).toContain('after desktop disconnect'));
    expect(backend.process?.killed).toBe(false);

    await engine.stop();
  });
});
