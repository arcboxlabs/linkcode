import { getProviderConfig } from '@linkcode/sdk';
import { useAgentRuntimes } from '../agent-runtime/hooks';
import { useData } from '../runtime/tayori';
import { selectableHarnessKinds } from '../settings/providers/model-options';
import { useNewSessionDefaultsStore } from '../surface/new-session-defaults-store';
import { useWorkspaces } from '../workspace/hooks';

export function useAutomationDefaults() {
  const { data: runtimes, error: runtimeError, mutate: refreshRuntimes } = useAgentRuntimes();
  const {
    data: providers,
    error: providerError,
    mutate: refreshProviders,
  } = useData(getProviderConfig, {});
  const { data: workspaces, error: workspaceError, mutate: refreshWorkspaces } = useWorkspaces();
  const lastHarness = useNewSessionDefaultsStore((state) => state.lastHarness);
  const lastWorkspace = useNewSessionDefaultsStore((state) => state.lastWorkspaceId);
  const kinds = providers
    ? selectableHarnessKinds(providers).filter((kind) => runtimes?.[kind]?.status === 'available')
    : [];
  const kind = lastHarness && kinds.includes(lastHarness) ? lastHarness : kinds.at(0);
  const workspaceMap = new Map(workspaces?.map((entry) => [entry.workspaceId, entry]));
  const workspace =
    (lastWorkspace ? workspaceMap.get(lastWorkspace) : undefined) ?? workspaces?.at(0);
  return {
    ready: runtimes !== undefined && providers !== undefined && workspaces !== undefined,
    error: runtimeError ?? providerError ?? workspaceError,
    kind,
    kinds,
    cwd: workspace?.cwd ?? '',
    retry: () => Promise.all([refreshRuntimes(), refreshProviders(), refreshWorkspaces()]),
  };
}
