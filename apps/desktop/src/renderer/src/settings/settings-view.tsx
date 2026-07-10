import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon, SettingsSidebarNav, ShellSidebar } from '@linkcode/ui';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import {
  BellIcon,
  BotIcon,
  HistoryIcon,
  InfoIcon,
  KeyRoundIcon,
  SettingsIcon,
  WifiIcon,
} from 'lucide-react';
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
import { NotificationsTab } from './notifications-tab';
import { ProvidersTab } from './providers-tab';
import type { SettingsCategory } from './store';
import { useDesktopSettingsStore } from './store';

const AGENT_KINDS: readonly AgentKind[] = AgentKindSchema.options;
const DEFAULT_HISTORY_PROVIDER: AgentKind = 'claude-code';

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
  // Store-held (not component state): the view lives inside the daemon-URL-keyed connection
  // subtree, and saving a new URL in the Connection tab must not reset the pane under the user.
  const category = useDesktopSettingsStore((state) => state.settingsCategory);
  const setCategory = useDesktopSettingsStore((state) => state.setSettingsCategory);
  const historyProvider = useDesktopSettingsStore((state) => state.historyImportProvider);
  const setHistoryProvider = useDesktopSettingsStore((state) => state.setHistoryImportProvider);
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
        // Immersive title: the chrome names the active panel. A tab that portals its own header
        // into main:left (history import) suppresses this default via the chrome's portal-wins
        // rule — no per-tab special case here.
        titleContent={
          <div className="pointer-events-none flex h-full min-w-0 items-center px-2">
            <span className="min-w-0 truncate font-semibold text-sm">
              {category === 'history-import'
                ? t('historyImport.portalLabel')
                : t(`tabs.${category}`)}
            </span>
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
                    key: 'notifications',
                    icon: <BellIcon className="size-4" />,
                    label: t('tabs.notifications'),
                    active: category === 'notifications',
                    onClick: () => setCategory('notifications'),
                  },
                  {
                    key: 'about',
                    icon: <InfoIcon className="size-4" />,
                    label: t('tabs.about'),
                    active: category === 'about',
                    onClick: () => setCategory('about'),
                  },
                  {
                    key: 'providers',
                    icon: <KeyRoundIcon className="size-4" />,
                    label: t('tabs.providers'),
                    active: category === 'providers',
                    onClick: () => setCategory('providers'),
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
                    // The disclosure row selects the section's first provider (the accordion
                    // opens via `active`); it is never highlighted itself.
                    onClick() {
                      setCategory('history-import');
                      setHistoryProvider(DEFAULT_HISTORY_PROVIDER);
                    },
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
              {/* The providers tab is a master/detail split and needs the extra width. */}
              <div
                className={`mx-auto p-6 ${category === 'providers' ? 'max-w-5xl' : 'max-w-2xl'}`}
              >
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
    case 'notifications':
      return <NotificationsTab />;
    case 'about':
      return <AboutTab />;
    case 'providers':
      return <ProvidersTab />;
    case 'agents':
      return <AgentsTab />;
    case 'history-import':
      return <HistoryImportTab kind={historyProvider} />;
    default:
      return null;
  }
}
