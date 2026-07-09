import { AgentAccountsSettings } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useTranslations } from 'use-intl';

/** The shared provider × account editor lives in `@linkcode/workbench`; webview only adds the page title. */
export function AgentsSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('agents'));
  return <AgentAccountsSettings />;
}
