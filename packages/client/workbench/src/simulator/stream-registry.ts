import type { LinkCodeClient } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import { noop } from 'foxts/noop';

/** The slice of `LinkCodeClient` the stream registry needs. */
export type SimulatorStreamClient = Pick<
  LinkCodeClient,
  'simulatorStreamStart' | 'simulatorStreamStop'
>;

/** Panel-facing stream parameters: hardware H.264 at native resolution. 30 fps keeps the
 * client-side decode + native-resolution canvas composite well within one core's budget (60 fps
 * saturated it and made interaction stutter); hosts without H.264 fall back to JPEG frames. */
const STREAM_OPTIONS = { fps: 30, codec: 'h264' } as const;

/** Bridges the unmount→mount gap of the docked↔maximized handoff without stopping the stream. */
const CLOSE_DELAY_MS = 250;

export interface SimulatorStreamSnapshot {
  phase: 'starting' | 'streaming' | 'failed';
  /** The session that started the stream — it holds the device claim, so interactions must ride it. */
  sessionId: SessionId;
}

export interface SimulatorStreamLease {
  getSnapshot: () => SimulatorStreamSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Retry the stream start after `failed`. */
  restart: () => void;
  release: () => void;
}

interface RegistryEntry {
  refCount: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  snapshot: SimulatorStreamSnapshot;
  listeners: Set<() => void>;
}

const registries = new WeakMap<SimulatorStreamClient, Map<string, RegistryEntry>>();

function getRegistry(client: SimulatorStreamClient): Map<string, RegistryEntry> {
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

function startStream(
  client: SimulatorStreamClient,
  registry: Map<string, RegistryEntry>,
  udid: string,
  entry: RegistryEntry,
): void {
  client
    .simulatorStreamStart(entry.snapshot.sessionId, udid, STREAM_OPTIONS)
    .then(() => {
      if (registry.get(udid) !== entry) return;
      entry.snapshot = { ...entry.snapshot, phase: 'streaming' };
      notify(entry);
    })
    .catch(() => {
      if (registry.get(udid) !== entry) return;
      entry.snapshot = { ...entry.snapshot, phase: 'failed' };
      notify(entry);
    });
}

/**
 * Stream lifetime is keyed by device, not component mount: the deferred stop keeps one daemon
 * stream running across panel remounts, and the last lease out stops it. Frames themselves flow
 * through `client.subscribeSimulatorFrames` independently of this registry.
 */
export function acquireSimulatorStream(
  client: SimulatorStreamClient,
  udid: string,
  sessionId: SessionId,
): SimulatorStreamLease {
  const registry = getRegistry(client);
  let entry = registry.get(udid);

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
      snapshot: { phase: 'starting', sessionId },
      listeners: new Set(),
    };
    registry.set(udid, created);
    entry = created;
    startStream(client, registry, udid, created);
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
      if (registry.get(udid) !== leased || leased.snapshot.phase !== 'failed') return;
      leased.snapshot = { ...leased.snapshot, phase: 'starting' };
      notify(leased);
      startStream(client, registry, udid, leased);
    },
    release() {
      if (released) return;
      released = true;
      leased.refCount -= 1;
      if (leased.refCount > 0) return;
      leased.closeTimer = setTimeout(() => {
        if (registry.get(udid) !== leased || leased.refCount > 0) return;
        registry.delete(udid);
        // Best-effort: the daemon also stops the stream when the owning session drops.
        void client.simulatorStreamStop(leased.snapshot.sessionId, udid).catch(noop);
      }, CLOSE_DELAY_MS);
    },
  };
}

export function peekSimulatorStream(
  client: SimulatorStreamClient,
  udid: string,
): SimulatorStreamSnapshot | null {
  return registries.get(client)?.get(udid)?.snapshot ?? null;
}
