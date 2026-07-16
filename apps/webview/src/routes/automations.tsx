import type { SessionId } from '@linkcode/schema';
import { AutomationsView, useSessionSelectionStore } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

/** Full-page Automations surface (webview route). Opening a run's thread returns to the workbench. */
export function AutomationsRoute(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const navigate = useNavigate();
  usePageTitle(t('pageTitle'));

  const openThread = (sessionId: SessionId): void => {
    useSessionSelectionStore.getState().setSelectedId(sessionId);
    void navigate('/');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
        <Button render={<Link to="/" />} size="sm" variant="ghost">
          <ChevronLeftIcon className="size-4" />
          {t('back')}
        </Button>
        <span className="font-semibold text-sm">{t('title')}</span>
      </div>
      <div className="min-h-0 flex-1">
        <AutomationsView onOpenSession={openThread} />
      </div>
    </div>
  );
}
