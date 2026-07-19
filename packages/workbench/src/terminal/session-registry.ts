import type { LinkCodeClient } from '@linkcode/client-core';
import type { TerminalOpenOptions } from '@linkcode/schema';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';
import type { TerminalTransportClient } from './transport-session';
import { createTransportTerminalSession } from './transport-session';

/** The slice of `LinkCodeClient` the registry needs: transport frames plus open/close. */
export type TerminalSessionClient = TerminalTransportClient &
  Pick<
    LinkCodeClient,
    'openTerminal' | 'detachTerminal' | 'closeTerminal' | 'subscribeTerminalController'
  >;

/** What the panel renders: the live session plus where the open/exit lifecycle stands. */
export interface TerminalSnapshot {
  session: TerminalSession | null;
  terminalId: string | null;
  /** The open request failed or timed out; `restart()` retries. */
  failed: boolean;
  /** Set once the shell process exited; a null code means it was terminated by a signal. */
  exit: { code: number | null } | null;
  /** This attachment is the terminal's current input/resize controller. */
  canControl: boolean;
}

export interface TerminalSessionLease {
  getSnapshot: () => TerminalSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Re-open after `failed`/`exit`, replacing the entry's terminal in place. */
  restart: () => void;
  release: () => void;
}

export type { TerminalOpenOptions };

interface RegistryEntry {
  refCount: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped per open attempt so an abandoned open (restart/timeout/release) can tell it lost. */
  attempt: number;
  terminalId: string | null;
  unsubExit: (() => void) | null;
  unsubController: (() => void) | null;
  snapshot: TerminalSnapshot;
  listeners: Set<() => void>;
  exitListeners: Map<symbol, (exitCode: number | null) => void>;
  exitDelivered: boolean;
}

/**
 * Host-terminal lifetime is keyed to the acquiring key (the panel tab id), not component mount:
 * the deferred close bridges the unmount→mount gap of the docked↔maximized handoff, so maximizing
 * never spawns a second host terminal. When a tab actually closes, nothing re-acquires and this
 * client detaches — the daemon owns the PTY lifetime so another device can keep using it.
 */
const CLOSE_DELAY_MS = 50;
/** Past this the open is surfaced as failed; a late success is closed, not adopted. */
const OPEN_TIMEOUT_MS = 15000;

/** Shared no-entry/opening snapshot — stable identity for `useSyncExternalStore`. */
const OPENING_SNAPSHOT: TerminalSnapshot = {
  session: null,
  terminalId: null,
  failed: false,
  exit: null,
  canControl: false,
};

const registries = new WeakMap<TerminalSessionClient, Map<string, RegistryEntry>>();

function getRegistry(client: TerminalSessionClient): Map<string, RegistryEntry> {
  let registry = registries.get(client);
  if (!registry) {
    registry = new Map();
    registries.set(client, registry);
  }
  return registry;
}

function notify(entry: RegistryEntry): void {
  for (const listener of entry.listeners) listener();
}

function deliverExit(entry: RegistryEntry): void {
  if (entry.exitDelivered || entry.snapshot.exit === null) return;
  let onExit: ((exitCode: number | null) => void) | undefined;
  for (const listener of entry.exitListeners.values()) onExit = listener;
  if (!onExit) return;
  entry.exitDelivered = true;
  onExit(entry.snapshot.exit.code);
}

function startOpen(
  client: TerminalSessionClient,
  registry: Map<string, RegistryEntry>,
  key: string,
  entry: RegistryEntry,
  opts: TerminalOpenOptions,
): void {
  entry.attempt += 1;
  entry.exitDelivered = false;
  const attempt = entry.attempt;
  const isCurrent = (): boolean => registry.get(key) === entry && entry.attempt === attempt;

  const timeout = setTimeout(() => {
    if (!isCurrent()) return;
    entry.snapshot = {
      session: null,
      terminalId: null,
      failed: true,
      exit: null,
      canControl: false,
    };
    notify(entry);
  }, OPEN_TIMEOUT_MS);

  client
    .openTerminal(opts)
    .then((terminalId) => {
      clearTimeout(timeout);
      // Abandoned while pending (timed out, restarted, or released) — detach so another device
      // that already discovered the terminal keeps it; the daemon reaps an unattached host PTY.
      if (!isCurrent() || entry.snapshot.failed) {
        client.detachTerminal(terminalId);
        return;
      }
      const session = createTransportTerminalSession(client, terminalId);
      entry.terminalId = terminalId;
      entry.snapshot = {
        session,
        terminalId,
        failed: false,
        exit: null,
        canControl: client.terminalCanControl(terminalId),
      };
      entry.unsubController = client.subscribeTerminalController(terminalId, (canControl) => {
        entry.snapshot = {
          ...entry.snapshot,
          canControl: entry.snapshot.exit === null && canControl,
        };
        notify(entry);
      });
      entry.unsubExit = client.subscribeTerminalExit(terminalId, (exitCode) => {
        entry.snapshot = {
          session,
          terminalId,
          failed: false,
          exit: { code: exitCode },
          canControl: false,
        };
        deliverExit(entry);
        notify(entry);
      });
      notify(entry);
    })
    .catch(() => {
      clearTimeout(timeout);
      if (!isCurrent()) return;
      entry.snapshot = {
        session: null,
        terminalId: null,
        failed: true,
        exit: null,
        canControl: false,
      };
      notify(entry);
    });
}

function disposeTerminal(
  client: TerminalSessionClient,
  entry: RegistryEntry,
  action: 'close' | 'detach',
): void {
  entry.unsubExit?.();
  entry.unsubExit = null;
  entry.unsubController?.();
  entry.unsubController = null;
  if (entry.terminalId !== null) {
    if (action === 'close' && client.terminalCanControl(entry.terminalId)) {
      client.closeTerminal(entry.terminalId);
    } else {
      client.detachTerminal(entry.terminalId);
    }
    entry.terminalId = null;
  }
}

export function acquireTerminalSession(
  client: TerminalSessionClient,
  key: string,
  opts: TerminalOpenOptions,
  onExit?: (exitCode: number | null) => void,
): TerminalSessionLease {
  const registry = getRegistry(client);
  let entry = registry.get(key);

  if (entry) {
    if (entry.closeTimer !== null) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }
    entry.refCount += 1;
  } else {
    const created: RegistryEntry = {
      refCount: 1,
      closeTimer: null,
      attempt: 0,
      terminalId: null,
      unsubExit: null,
      unsubController: null,
      snapshot: OPENING_SNAPSHOT,
      listeners: new Set(),
      exitListeners: new Map(),
      exitDelivered: false,
    };
    registry.set(key, created);
    entry = created;
    startOpen(client, registry, key, created, opts);
  }

  const leased = entry;
  let released = false;
  const exitListenerId = Symbol('terminal-exit-listener');
  if (onExit) {
    leased.exitListeners.set(exitListenerId, onExit);
    deliverExit(leased);
  }

  return {
    getSnapshot: () => leased.snapshot,
    subscribe(listener) {
      leased.listeners.add(listener);
      return () => leased.listeners.delete(listener);
    },
    restart() {
      if (registry.get(key) !== leased) return;
      disposeTerminal(client, leased, 'close');
      leased.snapshot = OPENING_SNAPSHOT;
      notify(leased);
      startOpen(client, registry, key, leased, opts);
    },
    release() {
      if (released) return;
      released = true;
      leased.exitListeners.delete(exitListenerId);
      leased.refCount -= 1;
      if (leased.refCount > 0) return;
      leased.closeTimer = setTimeout(() => {
        if (registry.get(key) !== leased || leased.refCount > 0) return;
        registry.delete(key);
        disposeTerminal(client, leased, 'detach');
        // Still opening: the open callback above sees the entry is gone and detaches it.
      }, CLOSE_DELAY_MS);
    },
  };
}

export function peekTerminalSnapshot(client: TerminalSessionClient, key: string): TerminalSnapshot {
  return registries.get(client)?.get(key)?.snapshot ?? OPENING_SNAPSHOT;
}
