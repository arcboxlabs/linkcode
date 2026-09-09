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
  // A runtime the host cannot spawn has no catalog to serve — the adapter throws and SWR retries
  // the failure indefinitely — so a `missing` kind is not requested (the harness picker already
  // badges it "Not installed"). Loading pauses every request; a kind the host never evaluated is
  // absent from the snapshot and stays fail-open, like `deriveAgentRuntimeCues`.
  const request = (agentKind: AgentKind) =>
    runtimes !== undefined && runtimes[agentKind]?.status !== 'missing' ? { agentKind, cwd } : null;
  const claude = useData(getAgentCatalog, request('claude-code'), SCOPED);
  const codex = useData(getAgentCatalog, request('codex'), SCOPED);
  const opencode = useData(getAgentCatalog, request('opencode'), SCOPED);
  const pi = useData(getAgentCatalog, request('pi'), SCOPED);
  const grok = useData(getAgentCatalog, request('grok-build'), SCOPED);
  return {
    ...(claude.data && { 'claude-code': claude.data }),
    ...(codex.data && { codex: codex.data }),
    ...(opencode.data && { opencode: opencode.data }),
    ...(pi.data && { pi: pi.data }),
    ...(grok.data && { 'grok-build': grok.data }),
  };
}
