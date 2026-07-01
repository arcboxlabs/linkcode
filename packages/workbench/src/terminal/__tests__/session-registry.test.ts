import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSessionClient } from '../session-registry';
import { acquireTerminalSession, peekTerminalSession } from '../session-registry';

interface FakeClient extends TerminalSessionClient {
  opened: string[];
  closed: string[];
}

function createFakeClient(): FakeClient {
  let seq = 0;
  const opened: string[] = [];
  const closed: string[] = [];

  return {
    opened,
    closed,
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
    subscribeTerminalExit: () => noop,
    terminalInput: noop,
    resizeTerminal: noop,
  };
}

describe('terminal session registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one terminal per key and reuses it across a release/acquire handoff', async () => {
    const client = createFakeClient();
    const first = acquireTerminalSession(client, 'tab-1', { cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.opened).toEqual(['term-1']);
    const session = first.getSession();
    expect(session).not.toBeNull();

    // Docked → maximized handoff: release and re-acquire within the close delay.
    first.release();
    const second = acquireTerminalSession(client, 'tab-1', { cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.opened).toEqual(['term-1']);
    expect(client.closed).toEqual([]);
    expect(second.getSession()).toBe(session);
    expect(peekTerminalSession(client, 'tab-1')).toBe(session);

    // Final release with no re-acquire actually closes the host terminal.
    second.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.closed).toEqual(['term-1']);
    expect(peekTerminalSession(client, 'tab-1')).toBeNull();
  });

  it('notifies subscribers once the terminal opens', async () => {
    const client = createFakeClient();
    const lease = acquireTerminalSession(client, 'tab-1', { cols: 80, rows: 24 });
    expect(lease.getSession()).toBeNull();
    const seen: unknown[] = [];
    lease.subscribe(() => seen.push(lease.getSession()));
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

    const lease = acquireTerminalSession(client, 'tab-1', { cols: 80, rows: 24 });
    lease.release();
    // The close timer fires while the open is still pending, expiring the entry.
    await vi.advanceTimersByTimeAsync(1000);
    resolveOpen('term-late');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.closed).toEqual(['term-late']);
    expect(peekTerminalSession(client, 'tab-1')).toBeNull();
  });
});
