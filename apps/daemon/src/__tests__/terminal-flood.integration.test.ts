import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEngineLayer } from '@linkcode/engine';
import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage, SocketIoTransport } from '@linkcode/transport';
import type { SocketIoServer } from '@linkcode/transport/server';
import { createSocketIoServer, Hub } from '@linkcode/transport/server';
import { ManagedRuntime } from 'effect';
import { noop } from 'foxts/noop';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binaryName, SidecarPtyBackend } from '../pty/sidecar';

/**
 * CODE-231 regression: a terminal flooding at full PTY speed must not starve the control plane.
 * Two raw wire clients against a real Engine + Hub + socket.io server + Rust sidecar: client A
 * hosts a `yes`-style flood (acking like client-core does), while client B's requests, terminal
 * open, and input echo must stay responsive. Before credit flow control, the flood ballooned the
 * socket buffers and B's frames sat behind megabytes of output.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const BINARY =
  [
    process.env.LINKCODE_PTY_SIDECAR_PATH,
    join(repoRoot, 'target', 'debug', binaryName()),
    join(repoRoot, 'target', 'release', binaryName()),
  ].find((path) => !!path && existsSync(path)) ?? '';

const ACK_CHUNK = 64 * 1024;

/** Raw wire client: no client-core (the daemon must not depend on it); acks are hand-rolled. */
class RawWireClient {
  readonly transport: SocketIoTransport;
  private readonly waiters = new Set<(p: WirePayload) => void>();

  constructor(url: string) {
    this.transport = new SocketIoTransport({ url });
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    this.transport.onMessage((message) => {
      for (const waiter of this.waiters) waiter(message.payload);
    });
  }

  send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }

  /** Subscribe to every inbound payload; returns an unsubscribe. */
  onPayload(cb: (p: WirePayload) => void): () => void {
    this.waiters.add(cb);
    return () => this.waiters.delete(cb);
  }

  waitFor<T>(pick: (p: WirePayload) => T | undefined, what: string, timeoutMs = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let unsubscribe: () => void = noop;
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`timed out waiting for ${what}`));
      }, timeoutMs);
      unsubscribe = this.onPayload((p) => {
        const picked = pick(p);
        if (picked === undefined) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(picked);
      });
    });
  }

  /** Open a terminal and return its id, mimicking client-core's open + credentials. */
  async openTerminal(name: string): Promise<{ terminalId: string; ack: (n: number) => void }> {
    const credentials = { attachmentId: `${name}-att`, attachmentSecret: 's'.repeat(32) };
    const clientReqId = `${name}-open`;
    const opened = this.waitFor(
      (p) => (p.kind === 'terminal.opened' && p.replyTo === clientReqId ? p : undefined),
      `terminal.opened for ${name}`,
    );
    this.send({
      kind: 'terminal.open',
      clientReqId,
      opts: { cols: 80, rows: 24, shell: '/bin/sh' },
      ...credentials,
    });
    const terminalId = (await opened).terminal.terminalId;
    return {
      terminalId,
      ack: (acked: number) => {
        this.send({ kind: 'terminal.ack', terminalId, acked, ...credentials });
      },
    };
  }

  input(terminalId: string, name: string, data: string): void {
    this.send({
      kind: 'terminal.input',
      terminalId,
      data,
      attachmentId: `${name}-att`,
      attachmentSecret: 's'.repeat(32),
    });
  }

  close(): void {
    this.transport.close();
  }
}

describe.skipIf(!BINARY || process.platform === 'win32')(
  'terminal flood does not starve the control plane',
  () => {
    let server: SocketIoServer;
    let hub: Hub;
    let disposeEngine: () => Promise<void>;
    let backend: SidecarPtyBackend;
    let clientA: RawWireClient;
    let clientB: RawWireClient;

    beforeAll(async () => {
      hub = new Hub();
      backend = new SidecarPtyBackend(BINARY);
      const engine = ManagedRuntime.make(makeEngineLayer(hub, { ptyBackend: backend }));
      await engine.context();
      disposeEngine = () => engine.dispose();
      server = await createSocketIoServer({ port: 0, host: '127.0.0.1' });
      server.onConnection((conn: Transport) => hub.addConnection(conn));
      clientA = new RawWireClient(`http://127.0.0.1:${server.port}`);
      clientB = new RawWireClient(`http://127.0.0.1:${server.port}`);
      await clientA.connect();
      await clientB.connect();
    });

    afterAll(async () => {
      await disposeEngine();
      clientA.close();
      clientB.close();
      await server.close();
    });

    it('keeps client B responsive while client A hosts a full-speed flood', async () => {
      // Client A: spawn the flood and ack like client-core (cumulative, every 64K chars).
      const a = await clientA.openTerminal('flood');
      let bytesA = 0;
      let ackedA = 0;
      clientA.onPayload((p) => {
        if (p.kind !== 'terminal.output' || p.terminalId !== a.terminalId) return;
        bytesA += p.data.length;
        if (bytesA - ackedA >= ACK_CHUNK) {
          ackedA = bytesA;
          a.ack(ackedA);
        }
      });
      clientA.input(a.terminalId, 'flood', 'while :; do echo linkcode-flood-line; done\n');

      // The flood must sustain past one full credit window: proof that acks return PTY credit.
      const floodDeadline = Date.now() + 15000;
      while (bytesA < 2 * 1024 * 1024) {
        if (Date.now() > floodDeadline) throw new Error(`flood stalled at ${bytesA} bytes`);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 50);
          timer.unref();
        });
      }

      // Control-plane probe: correlated terminal.list round-trips mid-flood.
      const rtts: number[] = [];
      for (let i = 0; i < 5; i++) {
        const clientReqId = `b-list-${i}`;
        const started = Date.now();
        const listed = clientB.waitFor(
          (p) => (p.kind === 'terminal.listed' && p.replyTo === clientReqId ? p : undefined),
          `terminal.listed ${i}`,
          5000,
        );
        clientB.send({ kind: 'terminal.list', clientReqId });
        await listed;
        rtts.push(Date.now() - started);
      }
      const sorted = [...rtts].sort((x, y) => x - y);
      expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(500);
      expect(sorted.at(-1)).toBeLessThan(2000);

      // Opening a second terminal mid-flood must not time out ("Terminal failed to start").
      const openStarted = Date.now();
      const b = await clientB.openTerminal('second');
      expect(Date.now() - openStarted).toBeLessThan(3000);

      // And its echo round-trip stays interactive.
      const echoed = clientB.waitFor(
        (p) =>
          p.kind === 'terminal.output' &&
          p.terminalId === b.terminalId &&
          p.data.includes('linkcode-echo-marker')
            ? true
            : undefined,
        'echo round-trip on terminal B',
        5000,
      );
      clientB.input(b.terminalId, 'second', 'echo linkcode-echo-marker\n');
      const echoStarted = Date.now();
      await echoed;
      expect(Date.now() - echoStarted).toBeLessThan(2000);

      // The flood is still alive behind the probes (flow control, not a stall).
      const before = bytesA;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 500);
        timer.unref();
      });
      expect(bytesA).toBeGreaterThan(before);
    }, 30000);
  },
);
