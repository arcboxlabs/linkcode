import type { AssetManager } from '@linkcode/assets';
import type { AgentRuntimes } from '@linkcode/schema';

/** The agent kinds whose CLI pair the managed-asset store can install (CODE-111/114). */
export const MANAGED_AGENT_KINDS = ['claude-code', 'codex'] as const;

export type ManagedAgentKind = (typeof MANAGED_AGENT_KINDS)[number];

/**
 * Consent snapshot: agents with a prior managed install of any version (CODE-221). GC retains
 * superseded versions until their replacement lands, so this reads the same before or after it.
 */
export function consentedManagedAgents(assets: AssetManager): ManagedAgentKind[] {
  return MANAGED_AGENT_KINDS.filter((kind) => assets.hasInstallOnDisk(`agent:${kind}`));
}

/**
 * The boot background-refresh set: consented agents the probe found unusable. Agents never
 * installed here are excluded — their first download comes from the client's `asset.ensure`
 * (the onboarding Download card), never unprompted (CODE-221).
 */
export function agentsToRefresh(
  consented: readonly ManagedAgentKind[],
  runtimes: AgentRuntimes,
): ManagedAgentKind[] {
  return consented.filter((kind) => runtimes[kind]?.status !== 'available');
}
