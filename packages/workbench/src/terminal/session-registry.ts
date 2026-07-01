import type { LinkCodeClient } from '@linkcode/client-core';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';
import type { TerminalTransportClient } from './transport-session';
import { createTransportTerminalSession } from './transport-session';

/** The slice of `LinkCodeClient` the registry needs: transport frames plus open/close. */
export type TerminalSessionClient = TerminalTransportClient &
  Pick<LinkCodeClient, 'openTerminal' | 'closeTerminal'>;

export interface TerminalSessionLease {
  getSession: () => TerminalSession | null;
  subscribe: (listener: () => void) => () => void;
  release: () => void;
}

interface RegistryEntry {
  refCount: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  terminalId: string | null;
  session: TerminalSession | null;
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

const registries = new WeakMap<TerminalSessionClient, Map<string, RegistryEntry>>();

function getRegistry(client: TerminalSessionClient): Map<string, RegistryEntry> {
  let registry = registries.get(client);
  if (!registry) {
    registry = new Map();
    registries.set(client, registry);
  }
  return registry;
}

export function acquireTerminalSession(
  client: TerminalSessionClient,
  key: string,
  dims: { cols: number; rows: number },
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
      terminalId: null,
      session: null,
      listeners: new Set(),
    };
    registry.set(key, created);
    entry = created;

    client
      .openTerminal(dims)
      .then((terminalId) => {
        if (registry.get(key) !== created) {
          // Released (and expired) before the open resolved — don't leak the host terminal.
          client.closeTerminal(terminalId);
          return;
        }
        created.terminalId = terminalId;
        created.session = createTransportTerminalSession(client, terminalId);
        for (const listener of created.listeners) listener();
      })
      .catch(() => {
        // Open failure surfaces via the daemon's request.failed; dropping the entry lets a remount retry.
        if (registry.get(key) === created) registry.delete(key);
      });
  }

  const leased = entry;
  let released = false;

  return {
    getSession: () => leased.session,
    subscribe(listener) {
      leased.listeners.add(listener);
      return () => leased.listeners.delete(listener);
    },
    release() {
      if (released) return;
      released = true;
      leased.refCount -= 1;
      if (leased.refCount > 0) return;
      leased.closeTimer = setTimeout(() => {
        if (registry.get(key) !== leased || leased.refCount > 0) return;
        registry.delete(key);
        if (leased.terminalId !== null) client.closeTerminal(leased.terminalId);
        // Still opening: the open callback above sees the entry is gone and closes it.
      }, CLOSE_DELAY_MS);
    },
  };
}

export function peekTerminalSession(
  client: TerminalSessionClient,
  key: string,
): TerminalSession | null {
  return registries.get(client)?.get(key)?.session ?? null;
}
