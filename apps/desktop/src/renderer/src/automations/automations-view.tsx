import type { SessionId } from '@linkcode/schema';
import {
  AutomationsView,
  useNavigationHistoryStore,
  useSessionSelectionStore,
} from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { DESKTOP_CHROME_SPACER_CLASS } from '../shell/chrome/metrics';

/**
 * The Automations surface as a full-page desktop overlay (like Settings), raised over the workbench
 * by the navigation store. Mounted inside the connection gate — it needs the daemon to list
 * schedules. Opening a run's thread selects it and drops the overlay.
 */
export function DesktopAutomationsView(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const backFromOverlay = useNavigationHistoryStore((state) => state.backFromOverlay);
  const setOverlay = useNavigationHistoryStore((state) => state.setOverlay);
  const setSelectedId = useSessionSelectionStore((state) => state.setSelectedId);

  const openThread = (sessionId: SessionId): void => {
    setSelectedId(sessionId);
    setOverlay(null);
  };

  return (
    <div className="linkcode-desktop-shell fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <div aria-hidden className={`shrink-0 ${DESKTOP_CHROME_SPACER_CLASS}`} />
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
        <Button size="sm" variant="ghost" onClick={backFromOverlay}>
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
