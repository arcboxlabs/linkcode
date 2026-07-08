import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon, SettingsSidebarNav, ShellSidebar } from '@linkcode/ui';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { BotIcon, HistoryIcon, InfoIcon, SettingsIcon, WifiIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';
import { DesktopChrome } from '../shell/chrome/chrome';
import { DESKTOP_CHROME_METRICS_STYLE, DESKTOP_CHROME_SPACER_CLASS } from '../shell/chrome/metrics';
import type { DesktopShellStyle } from '../shell/layout/shell-style';
import { DEFAULT_LAYOUT } from '../shell/store/model';
import { AboutTab } from './about-tab';
import { AgentsTab } from './agents-tab';
import { ConnectionTab } from './connection-tab';
import { GeneralTab } from './general-tab';
import { HistoryImportTab } from './history-import-tab';

type SettingsCategory = 'general' | 'connection' | 'about' | 'agents' | 'history-import';

const AGENT_KINDS: readonly AgentKind[] = AgentKindSchema.options;

const SETTINGS_CHROME_STYLE: DesktopShellStyle = {
  ...DESKTOP_CHROME_METRICS_STYLE,
  '--lc-sidebar-w': `${DEFAULT_LAYOUT.sidebarW}px`,
  '--lc-right-w': '0px',
  '--lc-bottom-h': '0px',
};

/**
 * Full-page Settings surface. Rendered above the connection gate so it stays reachable even when the
 * daemon is unreachable (needed to fix a bad daemon URL). The workbench stays mounted underneath.
 */
export function SettingsView(): React.ReactNode {
  const t = useTranslations('settings');
  const backFromOverlay = useNavigationHistoryStore((state) => state.backFromOverlay);
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [historyProvider, setHistoryProvider] = useState<AgentKind>('claude-code');
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
      // defaultPrevented: an open popup (select, menu) consumed this Esc to dismiss itself.
      if (event.key === 'Escape' && !event.defaultPrevented) backFromOverlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backFromOverlay]);

  return (
    <div
      className="linkcode-desktop-shell fixed inset-0 z-50 bg-transparent text-foreground"
      style={SETTINGS_CHROME_STYLE}
    >
      <DesktopChrome
        header={{ title: t('title') }}
        sidebarOpen
        rightPanelOpen={false}
        bottomPanelOpen={false}
        expandedPanel={null}
        hasNativeBackdrop={hasNativeBackdrop}
        hasNativeTrafficLights={hasNativeTrafficLights}
        showWindowControls={showWindowControls}
        // Back lives in the settings sidebar, so suppress the workbench navigation controls.
        leftControls={null}
        rightControls={null}
        titleContent={
          <div className="pointer-events-none flex h-full min-w-0 items-center px-2">
            <span className="min-w-0 truncate font-semibold text-sm">{t('title')}</span>
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
                searchPlaceholder={t('searchPlaceholder')}
                items={[
                  {
                    key: 'general',
                    icon: <SettingsIcon className="size-4" />,
                    label: t('tabs.general'),
                    active: category === 'general',
                    onClick: () => setCategory('general'),
                  },
                  {
                    key: 'connection',
                    icon: <WifiIcon className="size-4" />,
                    label: t('tabs.connection'),
                    active: category === 'connection',
                    onClick: () => setCategory('connection'),
                  },
                  {
                    key: 'about',
                    icon: <InfoIcon className="size-4" />,
                    label: t('tabs.about'),
                    active: category === 'about',
                    onClick: () => setCategory('about'),
                  },
                  {
                    key: 'agents',
                    icon: <BotIcon className="size-4" />,
                    label: t('tabs.agents'),
                    active: category === 'agents',
                    onClick: () => setCategory('agents'),
                  },
                  {
                    key: 'history-import',
                    icon: <HistoryIcon className="size-4" />,
                    label: t('historyImport.portalLabel'),
                    active: category === 'history-import',
                    onClick: () => setCategory('history-import'),
                    children: AGENT_KINDS.map((agentKind) => ({
                      key: agentKind,
                      icon: <AgentIcon kind={agentKind} variant="ghost" />,
                      label: AGENT_LABELS[agentKind],
                      active: category === 'history-import' && historyProvider === agentKind,
                      onClick() {
                        setCategory('history-import');
                        setHistoryProvider(agentKind);
                      },
                    })),
                  },
                ]}
              />
            </ShellSidebar>
          </div>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="min-w-0 flex-1 overflow-y-auto pt-(--lc-chrome-h)">
              <div className="mx-auto max-w-2xl p-6">
                {renderSettingsPanel(category, historyProvider)}
              </div>
            </div>
          </main>
        </div>
      </DesktopChrome>
    </div>
  );
}

function renderSettingsPanel(
  category: SettingsCategory,
  historyProvider: AgentKind,
): React.ReactNode {
  switch (category) {
    case 'general':
      return <GeneralTab />;
    case 'connection':
      return <ConnectionTab />;
    case 'about':
      return <AboutTab />;
    case 'agents':
      return <AgentsTab />;
    case 'history-import':
      return <HistoryImportTab kind={historyProvider} />;
    default:
      return null;
  }
}
