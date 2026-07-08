import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import type { HistorySortOrder } from '@linkcode/ui';
import {
  AGENT_LABELS,
  AgentIcon,
  HistoryBrowserList,
  HistorySortSelect,
  SettingsSidebarNav,
  ShellIconButton,
  ShellSidebar,
} from '@linkcode/ui';
import { useHistoryImportSurface, useNavigationHistoryStore } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { RotateCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';
import { DesktopChrome } from '../shell/chrome/chrome';
import { DESKTOP_CHROME_METRICS_STYLE, DESKTOP_CHROME_SPACER_CLASS } from '../shell/chrome/metrics';
import type { DesktopShellStyle } from '../shell/layout/shell-style';
import { DEFAULT_LAYOUT } from '../shell/store/model';

const AGENT_KINDS: readonly AgentKind[] = AgentKindSchema.options;

const HISTORY_IMPORT_CHROME_STYLE: DesktopShellStyle = {
  ...DESKTOP_CHROME_METRICS_STYLE,
  '--lc-sidebar-w': `${DEFAULT_LAYOUT.sidebarW}px`,
  '--lc-right-w': '0px',
  '--lc-bottom-h': '0px',
};

/**
 * Full-page history import surface (the settings portal target): provider list in the sidebar,
 * that provider's conversations in the main pane, count/refresh/sort in the window chrome.
 * Rendered inside the connection gate — browsing needs the daemon — and over the workbench,
 * which stays mounted underneath (settings-view pattern: hidden + inert, never unmounted).
 */
export function HistoryImportView(): React.ReactNode {
  const t = useTranslations('settings');
  const backFromOverlay = useNavigationHistoryStore((state) => state.backFromOverlay);
  const [kind, setKind] = useState<AgentKind>('claude-code');
  const [sort, setSort] = useState<HistorySortOrder>('latest');
  const surface = useHistoryImportSurface(kind, sort);
  const [desktopPlatform, setDesktopPlatform] = useState<NodeJS.Platform | null>(null);
  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';
  const showWindowControls = desktopPlatform !== null && desktopPlatform !== 'darwin';

  useAbortableEffect((signal) => {
    void systemBridge.app.platform().then((platform) => {
      if (!signal.aborted) setDesktopPlatform(platform);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') backFromOverlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backFromOverlay]);

  return (
    <div
      className="linkcode-desktop-shell fixed inset-0 z-50 bg-transparent text-foreground"
      style={HISTORY_IMPORT_CHROME_STYLE}
    >
      <DesktopChrome
        header={{ title: t('historyImport.portalLabel') }}
        sidebarOpen
        rightPanelOpen={false}
        bottomPanelOpen={false}
        expandedPanel={null}
        hasNativeBackdrop={hasNativeBackdrop}
        hasNativeTrafficLights={hasNativeTrafficLights}
        showWindowControls={showWindowControls}
        // Back lives in the sidebar, so suppress the workbench navigation controls.
        leftControls={null}
        rightControls={
          <div className="pointer-events-auto flex items-center gap-1.5 [-webkit-app-region:no-drag]">
            <ShellIconButton label={t('historyImport.refresh')} onClick={surface.refresh}>
              <RotateCwIcon className="size-3.5" />
            </ShellIconButton>
            <HistorySortSelect value={sort} onChange={setSort} />
          </div>
        }
        titleContent={
          <div className="pointer-events-none flex h-full min-w-0 items-center gap-2 px-2">
            <span className="min-w-0 truncate font-semibold text-sm">
              {t('historyImport.chromeTitle', { provider: AGENT_LABELS[kind] })}
            </span>
            {surface.count > 0 && (
              <span className="shrink-0 text-muted-foreground text-xs">
                {t('historyImport.conversationCount', { count: surface.count })}
              </span>
            )}
          </div>
        }
        onShowSidebar={noop}
        onHideSidebar={noop}
        onToggleRight={noop}
        onToggleBottom={noop}
      >
        <div className="flex h-full min-h-0">
          <div className="w-(--lc-sidebar-w) shrink-0">
            <ShellSidebar
              className={hasNativeBackdrop ? 'bg-sidebar/25' : 'bg-sidebar'}
              topInset={<div aria-hidden className={`${DESKTOP_CHROME_SPACER_CLASS} shrink-0`} />}
            >
              <SettingsSidebarNav
                backLabel={t('back')}
                onBack={backFromOverlay}
                items={AGENT_KINDS.map((agentKind) => ({
                  key: agentKind,
                  icon: <AgentIcon kind={agentKind} variant="ghost" />,
                  label: AGENT_LABELS[agentKind],
                  active: kind === agentKind,
                  onClick: () => setKind(agentKind),
                }))}
              />
            </ShellSidebar>
          </div>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="min-w-0 flex-1 overflow-y-auto pt-(--lc-chrome-h)">
              <div className="mx-auto max-w-2xl p-6">
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
              </div>
            </div>
          </main>
        </div>
      </DesktopChrome>
    </div>
  );
}
