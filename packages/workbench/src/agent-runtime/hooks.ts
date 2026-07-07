import { listAgentRuntimes } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Which agent CLIs the host can actually spawn, keyed by agent kind (`AgentRuntimes`). Probed once
 * at daemon boot, so the result is stable for a connection's lifetime — no push invalidation, no
 * revalidation cue; kinds the host has not evaluated are absent (opencode until CODE-76).
 */
export function useAgentRuntimes() {
  return useData(listAgentRuntimes, {});
}
