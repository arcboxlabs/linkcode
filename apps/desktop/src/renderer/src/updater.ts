import type { UpdaterState } from '@linkcode/ipc';
import { useSyncExternalStore } from 'react';
import { systemBridge } from './ipc';

let snapshot: UpdaterState = { status: 'idle', version: null, progress: null };
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;

function publish(next: UpdaterState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribe) {
    unsubscribe = systemBridge.app.onUpdaterState(publish);
    const pendingSnapshot = snapshot;
    void systemBridge.app
      .updaterState()
      .then((state) => {
        if (snapshot === pendingSnapshot) publish(state);
      })
      .catch(() => {
        if (snapshot === pendingSnapshot) {
          publish({ status: 'error', version: null, progress: null });
        }
      });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    unsubscribe?.();
    unsubscribe = undefined;
  };
}

export function useUpdaterState(): UpdaterState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
