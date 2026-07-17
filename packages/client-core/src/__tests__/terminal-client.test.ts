import type {
  TerminalMetadata,
  TerminalReplayEvent,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkCodeClient } from '../client';
import { createConnectedLocalClient } from './local-client';

/** A transport whose every `send` rejects, so terminal frames always fail to leave. */
function terminalFrameFailingTransport(err: Error): Transport {
  let onMessage: (message: WireMessage) => void = noop;
  return {
    connect() {
      return Promise.resolve();
    },
    send(message) {
      if (message.payload.kind === 'ping') {
        queueMicrotask(() => onMessage(createWireMessage({ kind: 'pong' })));
        return;
      }
      if (message.payload.kind === 'terminal.attach') {
        const p = message.payload;
        queueMicrotask(() =>
          onMessage(
            createWireMessage({
              kind: 'terminal.attached',
              replyTo: p.clientReqId,
              terminal: metadata(p.terminalId, p.mode === 'control' ? p.attachmentId : null),
              replay: [],
              cutoffSeq: 0,
              truncated: false,
            }),
          ),
        );
        return;
      }
      return Promise.reject(err);
    },
    onMessage(cb) {
      onMessage = cb;
      return () => {
        onMessage = noop;
      };
    },
    onClose: () => noop,
    close: noop,
  };
}

function metadata(terminalId: string, controllerAttachmentId: string | null): TerminalMetadata {
  return {
    terminalId,
    cols: 80,
    rows: 24,
    managed: false,
    createdAt: 1,
    controllerAttachmentId,
  };
}

// Let the rejected send promise's `.catch` handler run.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('LinkCodeClient terminal error channel', () => {
  it('routes a failed terminal send to that terminal, and only that terminal', async () => {
    const client = new LinkCodeClient(terminalFrameFailingTransport(new Error('socket closed')));
    await client.connect();
    await client.attachTerminal('term-a');
    await client.takeTerminalControl('term-a');

    const errorsA: Error[] = [];
    const errorsB: Error[] = [];
    client.subscribeTerminalError('term-a', (err) => errorsA.push(err));
    client.subscribeTerminalError('term-b', (err) => errorsB.push(err));

    client.terminalInput('term-a', 'ls\n');
    await flushMicrotasks();

    expect(errorsA).toHaveLength(1);
    expect(errorsA[0]?.message).toContain('socket closed');
    expect(errorsB).toHaveLength(0);

    client.dispose();
  });

  it('stops delivering errors after unsubscribe', async () => {
    const client = new LinkCodeClient(terminalFrameFailingTransport(new Error('socket closed')));
    await client.connect();
    await client.attachTerminal('term-a');
    await client.takeTerminalControl('term-a');

    const errors: Error[] = [];
    const unsubscribe = client.subscribeTerminalError('term-a', (err) => errors.push(err));
    unsubscribe();

    client.terminalInput('term-a', 'ls\n');
    await flushMicrotasks();

    expect(errors).toHaveLength(0);

    client.dispose();
  });
});

describe('LinkCodeClient terminal attachments', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ingests output captured before terminal.opened resolves', async () => {
    let uuidSeq = 0;
    const { client, serverTransport } = await createConnectedLocalClient({
      randomUUID() {
        uuidSeq += 1;
        return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`;
      },
    });

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind !== 'terminal.open') return;
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.opened',
          replyTo: p.clientReqId,
          terminal: metadata('term-new', p.attachmentId),
          replay: [
            { type: 'write', seq: 1, data: 'early' },
            { type: 'resize', seq: 2, cols: 100, rows: 30 },
          ],
          cutoffSeq: 2,
          truncated: false,
        }),
      );
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.output',
          terminalId: 'term-new',
          seq: 3,
          data: 'live',
        }),
      );
    });

    await expect(client.openTerminal({ cols: 80, rows: 24 })).resolves.toBe('term-new');
    const events: TerminalReplayEvent[] = [];
    client.subscribeTerminalEvents('term-new', (event) => events.push(event));
    expect(events).toEqual([
      { type: 'write', seq: 1, data: 'early' },
      { type: 'resize', seq: 2, cols: 100, rows: 30 },
      { type: 'write', seq: 3, data: 'live' },
    ]);
    expect(client.terminalCanControl('term-new')).toBe(true);

    client.detachTerminal('term-new');
    client.dispose();
    serverTransport.close();
  });

  it('coalesces concurrent viewers, upgrades their shared attachment, and detaches on final release', async () => {
    let uuidSeq = 0;
    const randomUUID = () => {
      uuidSeq += 1;
      return `00000000-0000-4000-8000-${uuidSeq.toString(16).padStart(12, '0')}`;
    };
    const { client, serverTransport } = await createConnectedLocalClient({ randomUUID });
    const received: WirePayload[] = [];

    serverTransport.onMessage((message) => {
      const p = message.payload;
      received.push(p);
      if (p.kind === 'terminal.list') {
        serverTransport.send(
          createWireMessage({
            kind: 'terminal.listed',
            replyTo: p.clientReqId,
            terminals: [metadata('term-existing', null)],
          }),
        );
      }
      if (p.kind === 'terminal.attach') {
        serverTransport.send(
          createWireMessage({
            kind: 'terminal.attached',
            replyTo: p.clientReqId,
            terminal: metadata(p.terminalId, p.mode === 'control' ? p.attachmentId : null),
            replay: [
              { type: 'write', seq: 1, data: 'before' },
              { type: 'resize', seq: 2, cols: 100, rows: 30 },
            ],
            cutoffSeq: 2,
            truncated: false,
          }),
        );
        if (p.mode === 'view') {
          serverTransport.send(
            createWireMessage({
              kind: 'terminal.output',
              terminalId: p.terminalId,
              seq: 3,
              data: 'after',
            }),
          );
        }
      }
    });

    await expect(client.listTerminals()).resolves.toEqual([metadata('term-existing', null)]);
    const firstViewer = client.attachTerminal('term-existing');
    const secondViewer = client.attachTerminal('term-existing');
    const [firstAttached, secondAttached] = await Promise.all([firstViewer, secondViewer]);
    expect(firstAttached).toEqual({
      terminal: expect.objectContaining({ terminalId: 'term-existing' }),
      truncated: false,
    });
    expect(secondAttached).toEqual(firstAttached);
    expect(client.terminalCanControl('term-existing')).toBe(false);

    const viewAttach = received.filter((p) => p.kind === 'terminal.attach');
    expect(viewAttach).toHaveLength(1);
    expect(viewAttach[0]).toEqual(expect.objectContaining({ mode: 'view' }));

    await client.takeTerminalControl('term-existing');
    expect(client.terminalCanControl('term-existing')).toBe(true);
    const attachFrames = received.filter((p) => p.kind === 'terminal.attach');
    expect(attachFrames).toHaveLength(2);
    const [viewFrame, controlFrame] = attachFrames;
    expect(attachFrames.map((frame) => frame.mode)).toEqual(['view', 'control']);
    expect(controlFrame).toEqual(
      expect.objectContaining({
        attachmentId: viewFrame.attachmentId,
        attachmentSecret: viewFrame.attachmentSecret,
      }),
    );

    const events: TerminalReplayEvent[] = [];
    client.subscribeTerminalEvents('term-existing', (event) => events.push(event));
    expect(events).toEqual([
      { type: 'write', seq: 1, data: 'before' },
      { type: 'resize', seq: 2, cols: 100, rows: 30 },
      { type: 'write', seq: 3, data: 'after' },
    ]);
    client.terminalInput('term-existing', 'pwd\r');
    client.resizeTerminal('term-existing', 90, 28);
    await flushMicrotasks();
    expect(received).toContainEqual({
      kind: 'terminal.input',
      terminalId: 'term-existing',
      data: 'pwd\r',
      attachmentId: viewFrame.attachmentId,
      attachmentSecret: viewFrame.attachmentSecret,
    });

    serverTransport.send(
      createWireMessage({
        kind: 'terminal.controller.changed',
        terminalId: 'term-existing',
        controllerAttachmentId: 'another-device',
      }),
    );
    await flushMicrotasks();
    const sentBeforePassiveInput = received.length;
    client.terminalInput('term-existing', 'ignored');
    client.resizeTerminal('term-existing', 70, 20);
    await flushMicrotasks();
    expect(client.terminalCanControl('term-existing')).toBe(false);
    expect(received).toHaveLength(sentBeforePassiveInput);

    client.detachTerminal('term-existing');
    await flushMicrotasks();
    expect(received.filter((p) => p.kind === 'terminal.detach')).toHaveLength(0);
    client.detachTerminal('term-existing');
    await flushMicrotasks();
    expect(received.filter((p) => p.kind === 'terminal.detach')).toEqual([
      {
        kind: 'terminal.detach',
        terminalId: 'term-existing',
        attachmentId: viewFrame.attachmentId,
        attachmentSecret: viewFrame.attachmentSecret,
      },
    ]);
    const requestIds = received.flatMap((p) => ('clientReqId' in p ? [p.clientReqId] : []));
    expect(new Set(requestIds).size).toBe(requestIds.length);
    expect(requestIds.every((id) => id.startsWith('creq-'))).toBe(true);

    client.dispose();
    serverTransport.close();
  });

  it('replays history before accepting stale live frames during an immediate reattach', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind === 'terminal.detach') {
        // This belonged to the released attachment but reaches the client after its replacement
        // attachment has already entered the pending map.
        serverTransport.send(
          createWireMessage({
            kind: 'terminal.resized',
            terminalId: p.terminalId,
            seq: 3,
            cols: 100,
            rows: 30,
          }),
        );
        return;
      }
      if (p.kind !== 'terminal.attach') return;
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.attached',
          replyTo: p.clientReqId,
          terminal: { ...metadata(p.terminalId, null), cols: 100, rows: 30 },
          replay: [
            { type: 'resize', seq: 1, cols: 80, rows: 24 },
            { type: 'write', seq: 2, data: 'before resize' },
            { type: 'resize', seq: 3, cols: 100, rows: 30 },
          ],
          cutoffSeq: 3,
          truncated: false,
        }),
      );
    });

    await client.attachTerminal('term-reattach');
    client.detachTerminal('term-reattach');
    await client.attachTerminal('term-reattach');

    const events: TerminalReplayEvent[] = [];
    client.subscribeTerminalEvents('term-reattach', (event) => events.push(event));
    expect(events).toEqual([
      { type: 'resize', seq: 1, cols: 80, rows: 24 },
      { type: 'write', seq: 2, data: 'before resize' },
      { type: 'resize', seq: 3, cols: 100, rows: 30 },
    ]);

    client.detachTerminal('term-reattach');
    client.dispose();
    serverTransport.close();
  });

  it('replays an exit that arrives immediately after a tombstone attachment', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind !== 'terminal.attach') return;
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.attached',
          replyTo: p.clientReqId,
          terminal: metadata(p.terminalId, null),
          replay: [{ type: 'write', seq: 1, data: 'finished\r\n' }],
          cutoffSeq: 1,
          truncated: false,
        }),
      );
      serverTransport.send(
        createWireMessage({ kind: 'terminal.exit', terminalId: p.terminalId, exitCode: 7 }),
      );
    });

    await client.attachTerminal('term-finished');
    const events: TerminalReplayEvent[] = [];
    const exits: Array<number | null> = [];
    client.subscribeTerminalEvents('term-finished', (event) => events.push(event));
    client.subscribeTerminalExit('term-finished', (code) => exits.push(code));

    expect(events).toEqual([{ type: 'write', seq: 1, data: 'finished\r\n' }]);
    expect(exits).toEqual([7]);

    client.detachTerminal('term-finished');
    client.dispose();
    serverTransport.close();
  });

  it('acks ingested live output cumulatively, skipping replayed and deduped frames', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    vi.useFakeTimers();
    const received: WirePayload[] = [];
    serverTransport.onMessage((message) => {
      const p = message.payload;
      received.push(p);
      if (p.kind !== 'terminal.attach') return;
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.attached',
          replyTo: p.clientReqId,
          terminal: metadata(p.terminalId, null),
          replay: [{ type: 'write', seq: 1, data: 'replayed-not-acked' }],
          cutoffSeq: 1,
          truncated: false,
        }),
      );
    });

    await client.attachTerminal('term-ack');
    const output = (seq: number, data: string) =>
      serverTransport.send(
        createWireMessage({ kind: 'terminal.output', terminalId: 'term-ack', seq, data }),
      );

    // A big frame crosses the 64K chunk threshold: the ack goes out immediately, and counts only
    // live chars — the replayed event and the duplicate (stale seq) frame stay out of the total.
    output(2, 'x'.repeat(64 * 1024));
    output(2, 'duplicate-not-acked');
    await vi.advanceTimersByTimeAsync(0);
    const acks = () => received.filter((p) => p.kind === 'terminal.ack');
    expect(acks()).toHaveLength(1);
    expect(acks()[0]).toMatchObject({ terminalId: 'term-ack', acked: 64 * 1024 });

    // A small tail is acked by the trailing timer rather than immediately.
    output(3, 'tail');
    await vi.advanceTimersByTimeAsync(0);
    expect(acks()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(acks()).toHaveLength(2);
    expect(acks()[1]).toMatchObject({ acked: 64 * 1024 + 4 });

    client.detachTerminal('term-ack');
    client.dispose();
    serverTransport.close();
  });

  it('reports local replay truncation and clears the cache after final detach', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind !== 'terminal.attach') return;
      serverTransport.send(
        createWireMessage({
          kind: 'terminal.attached',
          replyTo: p.clientReqId,
          terminal: metadata(p.terminalId, null),
          replay: [],
          cutoffSeq: 0,
          truncated: false,
        }),
      );
    });

    await client.attachTerminal('term-long');
    const changes: boolean[] = [];
    client.subscribeTerminalReplayTruncated('term-long', (truncated) => changes.push(truncated));
    serverTransport.send(
      createWireMessage({
        kind: 'terminal.output',
        terminalId: 'term-long',
        seq: 1,
        data: 'x'.repeat(10 * 1024 * 1024 + 1),
      }),
    );
    await flushMicrotasks();

    expect(client.terminalReplayWasTruncated('term-long')).toBe(true);
    expect(changes).toEqual([true]);

    client.detachTerminal('term-long');
    expect(client.terminalReplayWasTruncated('term-long')).toBe(false);
    expect(changes).toEqual([true, false]);

    client.dispose();
    serverTransport.close();
  });
});
