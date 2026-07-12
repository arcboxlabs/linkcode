import { AgentsSettingsPanel, useProvidersSettingsStore } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

/** Runtime concerns only; account/model bindings live on the Providers page. */
export function AgentsSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('agents'));
  const navigate = useNavigate();
  const selectAccount = useProvidersSettingsStore((state) => state.select);
  return (
    <AgentsSettingsPanel
      onOpenProviders={(accountId) => {
        if (accountId !== undefined) selectAccount(accountId);
        void navigate('/settings/providers');
      }}
    />
  );
}
