import type { AgentKind, AgentStartCatalog } from '@linkcode/schema';
import { getAgentCatalog } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Pre-session capability catalogs, scoped to the workspace the new-session surface has selected.
 *
 * `cwd` is load-bearing: an adapter resolves its default approval tier from the workspace
 * (claude-code reads `permissions.defaultMode` out of `.claude/settings*.json`), so a cwd-less
 * request reports the generic fallback and the picker would name a tier the session would not
 * actually start in. Each cwd is its own tayori key, so switching workspaces refetches.
 */
export function useAgentStartCatalogs(cwd?: string): Partial<Record<AgentKind, AgentStartCatalog>> {
  const claude = useData(getAgentCatalog, { agentKind: 'claude-code', cwd });
  const codex = useData(getAgentCatalog, { agentKind: 'codex', cwd });
  const opencode = useData(getAgentCatalog, { agentKind: 'opencode', cwd });
  const pi = useData(getAgentCatalog, { agentKind: 'pi', cwd });
  const grok = useData(getAgentCatalog, { agentKind: 'grok-build', cwd });
  return {
    ...(claude.data && { 'claude-code': claude.data }),
    ...(codex.data && { codex: codex.data }),
    ...(opencode.data && { opencode: opencode.data }),
    ...(pi.data && { pi: pi.data }),
    ...(grok.data && { 'grok-build': grok.data }),
  };
}
