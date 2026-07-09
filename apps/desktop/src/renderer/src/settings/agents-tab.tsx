import { AgentAccountsSettings } from '@linkcode/workbench';

// The provider × account editor is a transport-backed workbench container. The desktop Settings
// overlay renders inside `WorkbenchProviders` (the `ungated` slot) but above the connection gate,
// so — like the history-import panel — the editor is reachable here and degrades to loading/error
// states while the daemon is unreachable.
export function AgentsTab(): React.ReactNode {
  return <AgentAccountsSettings />;
}
