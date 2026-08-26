import type { AssetService } from '@linkcode/engine';
import type { AgentKind, AgentRuntimes, ManagedAssetId } from '@linkcode/schema';

/**
 * Restricted-brand runtime-probe filter (CODE-618): a disallowed agent must never read as
 * `available` on a restricted build, however the boot probe actually found it (detected CLI,
 * managed install, or SDK-resolved) — the settings page and onboarding cards read straight off
 * this map. `null` (unrestricted, the default build) returns `runtimes` unchanged.
 */
export function filterAgentRuntimes(
  runtimes: AgentRuntimes,
  allowedAgents: readonly AgentKind[] | null,
): AgentRuntimes {
  if (allowedAgents === null) return runtimes;
  const filtered: AgentRuntimes = { ...runtimes };
  for (const kind of Object.keys(filtered) as AgentKind[]) {
    if (!allowedAgents.includes(kind)) filtered[kind] = { status: 'missing' };
  }
  return filtered;
}

/**
 * Restricted-brand managed-download gate (CODE-618): wraps the daemon's `AssetService` so an
 * excluded agent's managed asset disappears from every surface — `statuses`/`subscribe` never
 * mention it (keeping this wrapper consistent with `filterAgentRuntimes`'s `missing`), and a
 * client's `asset.ensure` for it gets the same "cannot be installed here" refusal
 * `ManagedAssetService` already gives an unpinnable asset — no new failure path to learn.
 * Tool assets (`kind: 'tool'`, e.g. aigateway) are never agent-gated. `null` (unrestricted) returns
 * `assets` unchanged.
 */
export function restrictedAssetService(
  assets: AssetService,
  allowedAgents: readonly AgentKind[] | null,
): AssetService {
  if (allowedAgents === null) return assets;
  const excluded = (id: ManagedAssetId): boolean =>
    id.kind === 'agent' && !allowedAgents.includes(id.name);
  return {
    statuses: () => assets.statuses().filter(({ id }) => !excluded(id)),
    subscribe: (listener) =>
      assets.subscribe((event) => {
        if (!excluded(event.id)) listener(event);
      }),
    ensure: (id: ManagedAssetId) => (excluded(id) ? Promise.resolve(undefined) : assets.ensure(id)),
  };
}
