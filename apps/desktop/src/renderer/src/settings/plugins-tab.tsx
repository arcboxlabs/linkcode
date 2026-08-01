import { PluginsSettingsPanel } from '@linkcode/workbench';

// A transport-backed workbench container: reachable above the connection gate, degrading to
// loading while the daemon is unreachable — same posture as the providers tab.
export function PluginsTab(): React.ReactNode {
  return <PluginsSettingsPanel />;
}
