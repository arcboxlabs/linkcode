import type { AgentKind, AgentStartCatalog } from '@linkcode/schema';
import { getAgentCatalog } from '@linkcode/sdk';
import { useAgentRuntimes } from '../agent-runtime/hooks';
import { useData } from '../runtime/tayori';

/**
 * Pre-session capability catalogs, scoped to the workspace the new-session surface has selected.
 *
 * `cwd` is load-bearing: an adapter resolves its default approval tier from the workspace
 * (claude-code reads `permissions.defaultMode` out of `.claude/settings*.json`), so a cwd-less
 * request reports the generic fallback and the picker would name a tier the session would not
 * actually start in. Each cwd is its own tayori key, so switching workspaces refetches.
 */
// Opt out of the provider-wide keepPreviousData, same reason as the seeded conversation: these
// results are identity-scoped, so on a workspace switch the previous workspace's catalog would
// keep answering — forever if the new request fails — and re-create the very mismatch this
// scoping removes.
const SCOPED = { keepPreviousData: false } as const;

export function useAgentStartCatalogs(cwd?: string): Partial<Record<AgentKind, AgentStartCatalog>> {
  const { data: runtimes } = useAgentRuntimes();
  const claude = useData(getAgentCatalog, { agentKind: 'claude-code', cwd }, SCOPED);
  const codex = useData(getAgentCatalog, { agentKind: 'codex', cwd }, SCOPED);
  const opencode = useData(getAgentCatalog, { agentKind: 'opencode', cwd }, SCOPED);
  const pi = useData(
    getAgentCatalog,
    runtimes?.pi?.status === 'available' ? { agentKind: 'pi', cwd } : null,
    SCOPED,
  );
  const grok = useData(getAgentCatalog, { agentKind: 'grok-build', cwd }, SCOPED);
  return {
    ...(claude.data && { 'claude-code': claude.data }),
    ...(codex.data && { codex: codex.data }),
    ...(opencode.data && { opencode: opencode.data }),
    ...(pi.data && { pi: pi.data }),
    ...(grok.data && { 'grok-build': grok.data }),
  };
}
