import { listAgentModels } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Each agent's own model catalog, keyed by agent kind (`AgentModels`). The host probes the
 * adapters lazily on the first request and caches per boot, so the result is stable for a
 * connection's lifetime — no push invalidation, no revalidation cue; kinds without a catalog
 * (or whose probe failed, e.g. CLI missing) are absent.
 */
export function useAgentModels() {
  return useData(listAgentModels, {});
}
