import type { AgentKind } from '@linkcode/schema';
import type { HistorySortOrder } from '@linkcode/ui';
import { AGENT_LABELS, HistoryBrowserList, HistorySortSelect, ShellIconButton } from '@linkcode/ui';
import { useHistoryImportSurface } from '@linkcode/workbench';
import { RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DesktopChromePortal } from '../shell/chrome/chrome';

/**
 * The Settings "Import chat history" panel for one provider (picked in the sidebar accordion).
 * Its header lives in the window chrome via portals — provider title + count on the left, the
 * refresh/sort controls on the right — so the pane itself is just the list. Settings renders
 * ungated, so while the daemon is unreachable the list degrades to its loading/error states.
 */
export function HistoryImportTab({ kind }: { kind: AgentKind }): React.ReactNode {
  const t = useTranslations('settings.historyImport');
  const [sort, setSort] = useState<HistorySortOrder>('latest');
  const surface = useHistoryImportSurface(kind, sort);

  return (
    <>
      <DesktopChromePortal segment="main" position="left">
        <div className="flex h-full min-w-0 items-center gap-2 px-2">
          <span className="min-w-0 truncate font-semibold text-sm">
            {t('panelTitle', { provider: AGENT_LABELS[kind] })}
          </span>
          {surface.count > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {t('conversationCount', { count: surface.count })}
            </span>
          )}
        </div>
      </DesktopChromePortal>
      <DesktopChromePortal segment="main" position="right">
        <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
          <ShellIconButton label={t('refresh')} onClick={surface.refresh}>
            <RotateCwIcon className="size-3.5" />
          </ShellIconButton>
          <HistorySortSelect value={sort} onChange={setSort} />
        </div>
      </DesktopChromePortal>
      <HistoryBrowserList
        entries={surface.entries}
        groupByProject={sort === 'project'}
        truncated={surface.truncated}
        isLoading={surface.isLoading}
        loadError={surface.loadError}
        importingId={surface.importingId}
        importError={surface.importError}
        onImport={surface.importEntry}
        onOpen={surface.openEntry}
        onRefresh={surface.refresh}
      />
    </>
  );
}
