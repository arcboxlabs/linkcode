import type { ConnectionSource } from '@linkcode/client-core';
import { ConnectionController, LinkCodeClient } from '@linkcode/client-core';
import type { HostProfile } from '@mobile/stores/host-store';
import { randomUUID } from 'expo-crypto';
import { createHostTransport } from './create-host-transport';
import { captureMobileProductEvent } from './product-analytics';

/**
 * Live connections, keyed by host. Ownership sits here rather than in a component because the
 * "keep other hosts connected" preference needs a socket to outlive the screen that opened it —
 * and because switching back to a warm host must reuse its connection instead of dialing again.
 *
 * Nothing reference-counts: {@link pruneConnections} is the single authority on what stays, and the
 * scope that knows the preference calls it.
 */
const connections = new Map<string, ConnectionController<LinkCodeClient>>();

/** The started controller for a host, created on first use. Idempotent — `start()` guards itself. */
export function connectionFor(host: HostProfile): ConnectionController<LinkCodeClient> {
  const existing = connections.get(host.id);
  if (existing) return existing;

  const controller = createController(host);
  connections.set(host.id, controller);
  controller.start();
  return controller;
}

/** Disposes every connection whose host is not in `keep`. */
export function pruneConnections(keep: ReadonlySet<string>): void {
  for (const [hostId, controller] of connections) {
    if (keep.has(hostId)) continue;
    connections.delete(hostId);
    controller.dispose();
  }
}

function createController(host: HostProfile): ConnectionController<LinkCodeClient> {
  const source: ConnectionSource = {
    resolve: () => ({
      endpoint: 'url' in host ? host.url : host.tunnelHostId,
      transport: createHostTransport(host),
    }),
  };
  return new ConnectionController(source, {
    createClient: (transport) => new LinkCodeClient(transport, { randomUUID }),
    onOutcome(outcome) {
      captureMobileProductEvent(
        outcome.status === 'ready' ? 'host connection ready' : 'host connection failed',
        { duration_ms: outcome.durationMs },
      );
    },
    // ~13s of dialing (250·2ⁿ capped at 5s), then stop and surface `error`. Unbounded retries
    // would drain a phone in someone's pocket and never give up on a permanent failure — a wire
    // version mismatch cannot heal. The AppState/NetInfo triggers restart a run when something
    // actually changed, which is the only time another attempt can succeed.
    retry: { retries: 6 },
  });
}
