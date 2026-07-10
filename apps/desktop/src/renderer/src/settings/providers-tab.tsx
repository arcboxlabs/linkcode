import { ProvidersSettingsPanel } from '@linkcode/workbench';

// A transport-backed workbench container: reachable above the connection gate (the `ungated`
// slot), degrading to loading/error while the daemon is unreachable — like the history-import tab.
export function ProvidersTab(): React.ReactNode {
  return <ProvidersSettingsPanel />;
}
