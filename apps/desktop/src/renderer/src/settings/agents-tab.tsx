import { AgentsSettingsPanel, useProvidersSettingsStore } from '@linkcode/workbench';
import { systemBridge } from '../ipc';
import { useDesktopSettingsStore } from './store';

// Build-time snapshot (CODE-618): read once, like app.tsx's — it never changes for the life of
// this process.
const { allowedAgents } = systemBridge.identity.restrictions();

// Runtime concerns only; account/model bindings live on the Providers tab, and the summary row
// jumps there with the bound account pre-selected.
export function AgentsTab(): React.ReactNode {
  const setCategory = useDesktopSettingsStore((state) => state.setSettingsCategory);
  const selectAccount = useProvidersSettingsStore((state) => state.select);
  return (
    <AgentsSettingsPanel
      allowedAgents={allowedAgents}
      onOpenProviders={(accountId) => {
        if (accountId !== undefined) selectAccount(accountId);
        setCategory('providers');
      }}
    />
  );
}
