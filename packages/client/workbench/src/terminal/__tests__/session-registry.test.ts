import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSessionClient } from '../session-registry';
import { acquireTerminalSession, peekTerminalSnapshot } from '../session-registry';

interface FakeClient extends TerminalSessionClient {
  opened: string[];
  closed: string[];
  detached: string[];
  attachments: Set<string>;
  controlled: Set<string>;
  exitCbs: Map<string, (code: number | null) => void>;
  controllerCbs: Map<string, (canControl: boolean) => void>;
}

function createFakeClient(): FakeClient {
  let seq = 0;
  const opened: string[] = [];
  const closed: string[] = [];
  const detached: string[] = [];
  const exitCbs = new Map<string, (code: number | null) => void>();
  const controllerCbs = new Map<string, (canControl: boolean) => void>();
  const attached = new Set<string>();
  const controlled = new Set<string>();

  return {
    opened,
    closed,
    detached,
    attachments: attached,
    controlled,
    exitCbs,
    controllerCbs,
    openTerminal() {
      seq += 1;
      const id = `term-${seq}`;
      opened.push(id);
      attached.add(id);
      controlled.add(id);
      return Promise.resolve(id);
    },
    detachTerminal(terminalId) {
      if (!attached.delete(terminalId)) return;
      detached.push(terminalId);
      controlled.delete(terminalId);
    },
    closeTerminal(terminalId) {
      if (!attached.delete(terminalId) || !controlled.has(terminalId)) return;
      closed.push(terminalId);
      controlled.delete(terminalId);
    },
    subscribeTerminalEvents: () => noop,
    subscribeTerminalExit(terminalId, cb) {
      exitCbs.set(terminalId, (code) => {
        cb(code);
        attached.delete(terminalId);
        controlled.delete(terminalId);
      });
      return () => exitCbs.delete(terminalId);
    },
    subscribeTerminalController(terminalId, cb) {
      controllerCbs.set(terminalId, (canControl) => {
        if (canControl) controlled.add(terminalId);
        else controlled.delete(terminalId);
        cb(canControl);
      });
      return () => controllerCbs.delete(terminalId);
    },
    terminalCanControl: (terminalId) => controlled.has(terminalId),
    terminalReplayWasTruncated: () => false,
    subscribeTerminalReplayTruncated: () => noop,
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
    expect(client.detached).toEqual([]);
    expect(second.getSnapshot().session).toBe(session);
    expect(peekTerminalSnapshot(client, 'tab-1').session).toBe(session);

    // Final release with no re-acquire only detaches; another device may still own the PTY.
    second.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.closed).toEqual([]);
    expect(client.detached).toEqual(['term-1']);
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

  it('detaches a terminal whose open resolves after the lease already expired', async () => {
    const client = createFakeClient();
    let resolveOpen: (id: string) => void = noop;
    client.openTerminal = () =>
      new Promise<string>((resolve) => {
        resolveOpen = resolve;
      });

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    lease.release();
    // The release timer fires while the open is still pending, expiring the entry.
    await vi.advanceTimersByTimeAsync(1000);
    client.attachments.add('term-late');
    client.controlled.add('term-late');
    resolveOpen('term-late');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.detached).toEqual(['term-late']);
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

  it('fails a hung open on timeout and detaches its late terminal', async () => {
    const client = createFakeClient();
    let resolveOpen: (id: string) => void = noop;
    client.openTerminal = () =>
      new Promise<string>((resolve) => {
        resolveOpen = resolve;
      });

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(20000);
    expect(lease.getSnapshot().failed).toBe(true);

    client.attachments.add('term-late');
    client.controlled.add('term-late');
    resolveOpen('term-late');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.detached).toEqual(['term-late']);
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
    expect(lease.getSnapshot()).toMatchObject({ session, exit: { code: 3 } });

    lease.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.opened).toEqual(['term-1', 'term-2']);
    expect(client.closed).toEqual([]);
    expect(lease.getSnapshot()).toMatchObject({ exit: null, failed: false });
    expect(lease.getSnapshot().session).not.toBe(session);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('preserves a signal exit as distinct from a running terminal', async () => {
    const client = createFakeClient();
    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);

    expect(lease.getSnapshot().exit).toBeNull();
    client.exitCbs.get('term-1')?.(null);
    expect(lease.getSnapshot().exit).toEqual({ code: null });

    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('preserves an exit delivered synchronously while the terminal opens', async () => {
    const client = createFakeClient();
    client.subscribeTerminalExit = (_terminalId, cb) => {
      cb(7);
      return noop;
    };

    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);

    expect(lease.getSnapshot()).toMatchObject({
      terminalId: 'term-1',
      failed: false,
      exit: { code: 7 },
      canControl: false,
    });
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('updates the mounted session when another attachment takes control', async () => {
    const client = createFakeClient();
    const lease = acquireTerminalSession(client, 'tab-1', dims);
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().canControl).toBe(true);

    client.controllerCbs.get('term-1')?.(false);
    expect(lease.getSnapshot().canControl).toBe(false);
    expect(lease.getSnapshot().session?.canControl()).toBe(false);

    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });
});
