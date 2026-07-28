import type { AssetManager } from '@linkcode/assets';
import type { AgentRuntimes } from '@linkcode/schema';
import { managedAgentAssetId } from '@linkcode/schema';

/** The agent kinds the managed-asset store can install: CLI pairs (CODE-111/114) and pi's
 * in-process npm closure (CODE-219). */
export const MANAGED_AGENT_KINDS = ['claude-code', 'codex', 'pi'] as const;

export type ManagedAgentKind = (typeof MANAGED_AGENT_KINDS)[number];

/**
 * Consent snapshot: agents with a prior managed install of any version (CODE-221). GC retains
 * superseded versions until their replacement lands, so this reads the same before or after it.
 */
export function consentedManagedAgents(assets: AssetManager): ManagedAgentKind[] {
  return MANAGED_AGENT_KINDS.filter((kind) => assets.hasInstallOnDisk(managedAgentAssetId(kind)));
}

/**
 * The boot background-refresh set: consented agents the probe found unusable, plus those whose
 * managed install spawns but is missing files the current catalog expects (`needsRepair` — the
 * refresh backfills them). Agents never installed here are excluded — their first download
 * comes from the client's `asset.ensure` (the onboarding Download card), never unprompted.
 */
export function agentsToRefresh(
  consented: readonly ManagedAgentKind[],
  runtimes: AgentRuntimes,
  assets: AssetManager,
): ManagedAgentKind[] {
  return consented.filter(
    (kind) =>
      runtimes[kind]?.status !== 'available' || assets.needsRepair(managedAgentAssetId(kind)),
  );
}
