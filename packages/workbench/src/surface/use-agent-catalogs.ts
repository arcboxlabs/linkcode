import type { AgentKind, AgentStartCatalog } from '@linkcode/schema';
import { getAgentCatalog } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Pre-session picker catalogs for every agent kind — the new-session surface's data source
 * (`agent.catalog`, served from never-started adapter instances on the daemon). Fetched for all
 * kinds up front (the `runtimeCues` pattern: the picked provider lives inside the surface) and
 * cached by SWR; machine-global scope (no cwd) — workspace-scoped answers (claude settings tier,
 * opencode project agents) are a follow-up once the surface reports its workspace pick upward.
 */
export function useAgentStartCatalogs(): Partial<Record<AgentKind, AgentStartCatalog>> {
  const claude = useData(getAgentCatalog, { agentKind: 'claude-code' });
  const codex = useData(getAgentCatalog, { agentKind: 'codex' });
  const opencode = useData(getAgentCatalog, { agentKind: 'opencode' });
  const pi = useData(getAgentCatalog, { agentKind: 'pi' });
  return {
    ...(claude.data && { 'claude-code': claude.data }),
    ...(codex.data && { codex: codex.data }),
    ...(opencode.data && { opencode: opencode.data }),
    ...(pi.data && { pi: pi.data }),
  };
}
