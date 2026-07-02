import type { LinkCodeClient } from '@linkcode/client-core';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';
import type { TerminalTransportClient } from './transport-session';
import { createTransportTerminalSession } from './transport-session';

/** The slice of `LinkCodeClient` the registry needs: transport frames plus open/close. */
export type TerminalSessionClient = TerminalTransportClient &
  Pick<LinkCodeClient, 'openTerminal' | 'closeTerminal'>;

/** What the panel renders: the live session plus where the open/exit lifecycle stands. */
export interface TerminalSnapshot {
  session: TerminalSession | null;
  terminalId: string | null;
  /** The open request failed or timed out; `restart()` retries. */
  failed: boolean;
  /** Set once the shell process exited; the session stays around for the dead buffer. */
  exitCode: number | null;
}

export interface TerminalSessionLease {
  getSnapshot: () => TerminalSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Re-open after `failed`/`exitCode`, replacing the entry's terminal in place. */
  restart: () => void;
  release: () => void;
}

export interface TerminalOpenOptions {
  cols: number;
  rows: number;
  cwd?: string;
}

interface RegistryEntry {
  refCount: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped per open attempt so an abandoned open (restart/timeout/release) can tell it lost. */
  attempt: number;
  terminalId: string | null;
  unsubExit: (() => void) | null;
  snapshot: TerminalSnapshot;
  listeners: Set<() => void>;
}

/**
 * Host-terminal lifetime is keyed to the acquiring key (the panel tab id), not to component
 * mount: the docked and maximized panel instances hand the same PTY off between them, so
 * maximizing never spawns a second host terminal. The deferred close bridges the
 * unmount→mount gap of that handoff (cleanup and setup run in the same React commit);
 * when a tab actually closes, nothing re-acquires and the host terminal is released.
 */
const CLOSE_DELAY_MS = 50;
/** Past this the open is surfaced as failed; a late success is closed, not adopted. */
const OPEN_TIMEOUT_MS = 15000;

/** Shared no-entry/opening snapshot — stable identity for `useSyncExternalStore`. */
const OPENING_SNAPSHOT: TerminalSnapshot = {
  session: null,
  terminalId: null,
  failed: false,
  exitCode: null,
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

function startOpen(
  client: TerminalSessionClient,
  registry: Map<string, RegistryEntry>,
  key: string,
  entry: RegistryEntry,
  opts: TerminalOpenOptions,
): void {
  entry.attempt += 1;
  const attempt = entry.attempt;
  const isCurrent = (): boolean => registry.get(key) === entry && entry.attempt === attempt;

  const timeout = setTimeout(() => {
    if (!isCurrent()) return;
    entry.snapshot = { session: null, terminalId: null, failed: true, exitCode: null };
    notify(entry);
  }, OPEN_TIMEOUT_MS);

  client
    .openTerminal(opts)
    .then((terminalId) => {
      clearTimeout(timeout);
      // Abandoned while pending (timed out, restarted, or released) — close instead of leaking
      // the host terminal; adopting a stale open would race a retry already in flight.
      if (!isCurrent() || entry.snapshot.failed) {
        client.closeTerminal(terminalId);
        return;
      }
      const session = createTransportTerminalSession(client, terminalId);
      entry.terminalId = terminalId;
      entry.unsubExit = client.subscribeTerminalExit(terminalId, (exitCode) => {
        entry.snapshot = { session, terminalId, failed: false, exitCode: exitCode ?? 0 };
        notify(entry);
      });
      entry.snapshot = { session, terminalId, failed: false, exitCode: null };
      notify(entry);
    })
    .catch(() => {
      clearTimeout(timeout);
      if (!isCurrent()) return;
      entry.snapshot = { session: null, terminalId: null, failed: true, exitCode: null };
      notify(entry);
    });
}

function disposeTerminal(client: TerminalSessionClient, entry: RegistryEntry): void {
  entry.unsubExit?.();
  entry.unsubExit = null;
  if (entry.terminalId !== null) {
    client.closeTerminal(entry.terminalId);
    entry.terminalId = null;
  }
}

export function acquireTerminalSession(
  client: TerminalSessionClient,
  key: string,
  opts: TerminalOpenOptions,
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
      snapshot: OPENING_SNAPSHOT,
      listeners: new Set(),
    };
    registry.set(key, created);
    entry = created;
    startOpen(client, registry, key, created, opts);
  }

  const leased = entry;
  let released = false;

  return {
    getSnapshot: () => leased.snapshot,
    subscribe(listener) {
      leased.listeners.add(listener);
      return () => leased.listeners.delete(listener);
    },
    restart() {
      if (registry.get(key) !== leased) return;
      disposeTerminal(client, leased);
      leased.snapshot = OPENING_SNAPSHOT;
      notify(leased);
      startOpen(client, registry, key, leased, opts);
    },
    release() {
      if (released) return;
      released = true;
      leased.refCount -= 1;
      if (leased.refCount > 0) return;
      leased.closeTimer = setTimeout(() => {
        if (registry.get(key) !== leased || leased.refCount > 0) return;
        registry.delete(key);
        disposeTerminal(client, leased);
        // Still opening: the open callback above sees the entry is gone and closes it.
      }, CLOSE_DELAY_MS);
    },
  };
}

export function peekTerminalSnapshot(client: TerminalSessionClient, key: string): TerminalSnapshot {
  return registries.get(client)?.get(key)?.snapshot ?? OPENING_SNAPSHOT;
}
