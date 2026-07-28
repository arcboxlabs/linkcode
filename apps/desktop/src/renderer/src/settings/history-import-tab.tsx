import type { AgentKind } from '@linkcode/schema';
import type { HistorySortOrder } from '@linkcode/ui';
import {
  AGENT_LABELS,
  HistoryBrowserList,
  HistoryImportAllDialog,
  HistorySortSelect,
  ShellIconButton,
} from '@linkcode/ui';
import {
  historyImportOnboardingAction,
  useBulkHistoryImport,
  useHistoryImportSurface,
} from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DesktopChromePortal } from '../shell/chrome/chrome';
import { useDesktopSettingsStore } from './store';

/**
 * Settings "Import chat history" panel for one provider. Its header lives in the window chrome via
 * portals, so the pane itself is just the list; Settings renders ungated, so while the daemon is
 * unreachable the list degrades to its loading/error states.
 */
export function HistoryImportTab({ kind }: { kind: AgentKind }): React.ReactNode {
  const t = useTranslations('settings.historyImport');
  const [sort, setSort] = useState<HistorySortOrder>('latest');
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const surface = useHistoryImportSurface(kind, sort);
  const bulk = useBulkHistoryImport();
  const onboardingHandled = useDesktopSettingsStore(
    (state) => state.historyImportOnboardingHandled,
  );
  const markOnboardingHandled = useDesktopSettingsStore(
    (state) => state.markHistoryImportOnboardingHandled,
  );
  const onboardingAction = historyImportOnboardingAction({
    handled: onboardingHandled,
    scansComplete: bulk.scanComplete,
    importableCount: bulk.importableCount,
  });

  useEffect(() => {
    if (onboardingAction !== 'complete') return;
    void markOnboardingHandled().catch(noop);
  }, [onboardingAction, markOnboardingHandled]);

  function setImportAllOpen(open: boolean): void {
    if (open) {
      bulk.resetResult();
      setManualImportOpen(true);
      return;
    }
    setManualImportOpen(false);
    setOnboardingDismissed(true);
    if (!onboardingHandled) void markOnboardingHandled().catch(noop);
  }

  function confirmImportAll(): void {
    setManualImportOpen(true);
    if (!onboardingHandled) void markOnboardingHandled().catch(noop);
    void bulk.importAll();
  }

  return (
    <>
      <DesktopChromePortal segment="main" position="left" className="gap-2 px-2">
        <span className="min-w-0 truncate font-semibold text-sm">
          {t('panelTitle', { provider: AGENT_LABELS[kind] })}
        </span>
        {surface.count > 0 && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {t('conversationCount', { count: surface.count })}
          </span>
        )}
      </DesktopChromePortal>
      <DesktopChromePortal
        segment="main"
        position="right"
        className="gap-1.5 [-webkit-app-region:no-drag]"
      >
        {!bulk.isScanning && bulk.importableCount > 0 && (
          <Button size="xs" variant="outline" onClick={() => setImportAllOpen(true)}>
            {t('importAllAction', { count: bulk.importableCount })}
          </Button>
        )}
        <ShellIconButton label={t('refresh')} onClick={surface.refresh}>
          <RotateCwIcon className="size-3.5" />
        </ShellIconButton>
        <HistorySortSelect value={sort} onChange={setSort} />
      </DesktopChromePortal>
      <HistoryBrowserList
        entries={surface.entries}
        groupByProject
        truncated={surface.truncated}
        isLoading={surface.isLoading}
        loadError={surface.loadError}
        importingIds={surface.importingIds}
        importingCwds={surface.importingCwds}
        importErrors={surface.importErrors}
        groupImportFailures={surface.groupImportFailures}
        actionError={surface.actionError}
        onImport={surface.importEntry}
        onImportGroup={surface.importGroup}
        onOpen={surface.openEntry}
        onRefresh={surface.refresh}
      />
      <HistoryImportAllDialog
        open={manualImportOpen || (!onboardingDismissed && onboardingAction === 'offer')}
        importableCount={bulk.importableCount}
        scanFailedCount={bulk.scanFailedCount}
        importing={bulk.isImporting}
        result={bulk.result}
        onOpenChange={setImportAllOpen}
        onConfirm={confirmImportAll}
      />
    </>
  );
}
