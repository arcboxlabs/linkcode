import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSessionClient } from '../session-registry';
import { acquireTerminalSession, peekTerminalSnapshot } from '../session-registry';

interface FakeClient extends TerminalSessionClient {
  opened: string[];
  closed: string[];
  exitCbs: Map<string, (code: number | null) => void>;
}

function createFakeClient(): FakeClient {
  let seq = 0;
  const opened: string[] = [];
  const closed: string[] = [];
  const exitCbs = new Map<string, (code: number | null) => void>();

  return {
    opened,
    closed,
    exitCbs,
    openTerminal() {
      seq += 1;
      const id = `term-${seq}`;
      opened.push(id);
      return Promise.resolve(id);
    },
    closeTerminal(terminalId) {
      closed.push(terminalId);
    },
    subscribeTerminalOutput: () => noop,
    subscribeTerminalExit(terminalId, cb) {
      exitCbs.set(terminalId, cb);
      return () => exitCbs.delete(terminalId);
    },
    terminalInput: noop,
    resizeTerminal: noop,
  };
}

const dims = { cols: 80, rows: 24 };

describe('terminal session registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one terminal per key and reuses it across a release/acquire handoff', async () => {
    const client = createFakeClient();
    const first = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.opened).toEqual(['term-1']);
    const { session } = first.getSnapshot();
    expect(session).not.toBeNull();

    // Docked → maximized handoff: release and re-acquire within the close delay.
    first.release();
    const second = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.opened).toEqual(['term-1']);
    expect(client.closed).toEqual([]);
    expect(second.getSnapshot().session).toBe(session);
    expect(peekTerminalSnapshot(client, 'tab-1').session).toBe(session);

    // Final release with no re-acquire actually closes the host terminal.
    second.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.closed).toEqual(['term-1']);
    expect(peekTerminalSnapshot(client, 'tab-1').session).toBeNull();
  });

  it('notifies subscribers once the terminal opens', async () => {
    const client = createFakeClient();
    const lease = acquireTerminalSession(client, 'tab-1', dims);
    expect(lease.getSnapshot().session).toBeNull();
    const seen: unknown[] = [];
    lease.subscribe(() => seen.push(lease.getSnapshot().session));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBeNull();
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('closes a terminal whose open resolves after the lease already expired', async () => {
    const client = createFakeClient();
    let resolveOpen: (id: string) => void = noop;
    client.openTerminal = () =>
      new Promise<string>((resolve) => {
        resolveOpen = resolve;
      });

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    lease.release();
    // The close timer fires while the open is still pending, expiring the entry.
    await vi.advanceTimersByTimeAsync(1000);
    resolveOpen('term-late');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.closed).toEqual(['term-late']);
    expect(peekTerminalSnapshot(client, 'tab-1').session).toBeNull();
  });

  it('surfaces a rejected open as failed and recovers via restart', async () => {
    const client = createFakeClient();
    const open = client.openTerminal.bind(client);
    client.openTerminal = () => Promise.reject(new Error('no sidecar'));

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().failed).toBe(true);

    client.openTerminal = open;
    lease.restart();
    expect(lease.getSnapshot().failed).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().session).not.toBeNull();
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('fails a hung open on timeout and closes its late terminal', async () => {
    const client = createFakeClient();
    let resolveOpen: (id: string) => void = noop;
    client.openTerminal = () =>
      new Promise<string>((resolve) => {
        resolveOpen = resolve;
      });

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(20000);
    expect(lease.getSnapshot().failed).toBe(true);

    resolveOpen('term-late');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.closed).toEqual(['term-late']);
    expect(lease.getSnapshot().failed).toBe(true);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('records the exit code and reopens a fresh terminal on restart', async () => {
    const client = createFakeClient();
    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);
    const { session } = lease.getSnapshot();

    client.exitCbs.get('term-1')?.(3);
    expect(lease.getSnapshot()).toMatchObject({ session, exitCode: 3 });

    lease.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.opened).toEqual(['term-1', 'term-2']);
    expect(client.closed).toEqual(['term-1']);
    expect(lease.getSnapshot()).toMatchObject({ exitCode: null, failed: false });
    expect(lease.getSnapshot().session).not.toBe(session);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });
});
