import { AgentsSettingsPanel, useProvidersSettingsStore } from '@linkcode/workbench';
import { useDesktopSettingsStore } from './store';

// Runtime concerns only; account/model bindings live on the Providers tab, and the summary row
// jumps there with the bound account pre-selected.
export function AgentsTab(): React.ReactNode {
  const setCategory = useDesktopSettingsStore((state) => state.setSettingsCategory);
  const selectAccount = useProvidersSettingsStore((state) => state.select);
  return (
    <AgentsSettingsPanel
      onOpenProviders={(accountId) => {
        if (accountId !== undefined) selectAccount(accountId);
        setCategory('providers');
      }}
    />
  );
}
