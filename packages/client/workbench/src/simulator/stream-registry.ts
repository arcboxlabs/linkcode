import type { LinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SimulatorStreamCodec } from '@linkcode/schema';
import { noop } from 'foxts/noop';

/** The slice of `LinkCodeClient` the stream registry needs. */
export type SimulatorStreamClient = Pick<
  LinkCodeClient,
  'simulatorStreamStart' | 'simulatorStreamStop'
>;

/** Panel-facing stream parameters. The client draws the framebuffer on its own layer (one draw + one
 * mask composite per frame, vsync-aligned), so even 60 fps no longer saturates a core the way the old
 * whole-device repaint did; a host without H.264 falls back to JPEG frames regardless of `codec`. */
export interface SimulatorStreamOptions {
  fps: number;
  /** Downscale factor before encode (0..1; 1 = native). */
  scale: number;
  codec: SimulatorStreamCodec;
}

function optionsEqual(a: SimulatorStreamOptions, b: SimulatorStreamOptions): boolean {
  return a.fps === b.fps && a.scale === b.scale && a.codec === b.codec;
}

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
  /** Parameters the running (or next) stream uses; changing them restarts the stream in place. */
  options: SimulatorStreamOptions;
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
  const started = entry.options;
  client
    .simulatorStreamStart(entry.snapshot.sessionId, udid, started)
    .then(() => {
      if (registry.get(udid) !== entry) return;
      entry.snapshot = { ...entry.snapshot, phase: 'streaming' };
      notify(entry);
      // A retune that landed mid-start could not restart yet (no stream to stop); do it now.
      if (!optionsEqual(started, entry.options)) restartStream(client, registry, udid, entry);
    })
    .catch(() => {
      if (registry.get(udid) !== entry) return;
      entry.snapshot = { ...entry.snapshot, phase: 'failed' };
      notify(entry);
    });
}

/** Stop then restart a live stream so the sidecar re-parameterizes it (it no-ops a `streamStart`
 * while one already runs). The lease, its listeners, and the frame subscription all survive. */
function restartStream(
  client: SimulatorStreamClient,
  registry: Map<string, RegistryEntry>,
  udid: string,
  entry: RegistryEntry,
): void {
  entry.snapshot = { ...entry.snapshot, phase: 'starting' };
  notify(entry);
  void client
    .simulatorStreamStop(entry.snapshot.sessionId, udid)
    .catch(noop)
    .finally(() => {
      if (registry.get(udid) !== entry) return;
      startStream(client, registry, udid, entry);
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
  options: SimulatorStreamOptions,
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
      options,
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

/**
 * Retune a running device stream. The sidecar cannot re-parameterize a live stream (`streamStart`
 * no-ops once one exists), so a change stops and restarts it in place — the lease, its listeners,
 * and the independent frame subscription all survive; only the daemon stream blips. A no-op when the
 * options are unchanged or no stream exists (the next {@link acquireSimulatorStream} carries them).
 */
export function setSimulatorStreamOptions(
  client: SimulatorStreamClient,
  udid: string,
  options: SimulatorStreamOptions,
): void {
  const registry = registries.get(client);
  const entry = registry?.get(udid);
  if (registry === undefined || entry === undefined || optionsEqual(entry.options, options)) return;
  entry.options = options;
  // Only an established stream restarts now; a still-starting one adopts the options when its start
  // completes (startStream re-checks), and a failed one uses them on the next `restart`.
  if (entry.snapshot.phase === 'streaming') restartStream(client, registry, udid, entry);
}
