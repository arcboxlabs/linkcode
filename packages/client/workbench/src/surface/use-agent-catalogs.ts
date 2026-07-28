import type { AgentKind, AgentStartCatalog } from '@linkcode/schema';
import { getAgentCatalog } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

export function useAgentStartCatalogs(): Partial<Record<AgentKind, AgentStartCatalog>> {
  const claude = useData(getAgentCatalog, { agentKind: 'claude-code' });
  const codex = useData(getAgentCatalog, { agentKind: 'codex' });
  const opencode = useData(getAgentCatalog, { agentKind: 'opencode' });
  const pi = useData(getAgentCatalog, { agentKind: 'pi' });
  const grok = useData(getAgentCatalog, { agentKind: 'grok-build' });
  return {
    ...(claude.data && { 'claude-code': claude.data }),
    ...(codex.data && { codex: codex.data }),
    ...(opencode.data && { opencode: opencode.data }),
    ...(pi.data && { pi: pi.data }),
    ...(grok.data && { 'grok-build': grok.data }),
  };
}
