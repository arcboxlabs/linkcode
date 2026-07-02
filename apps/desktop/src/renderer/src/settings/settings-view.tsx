import { ShellSidebar, ShellSidebarItem } from '@linkcode/ui';
import { Input } from 'coss-ui/components/input';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import {
  BotIcon,
  ChevronLeftIcon,
  InfoIcon,
  SearchIcon,
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
import { useDesktopSettingsStore } from './store';

type SettingsCategory = 'general' | 'connection' | 'about' | 'agents';

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
  const closeSettings = useDesktopSettingsStore((state) => state.closeSettings);
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [desktopPlatform, setDesktopPlatform] = useState<NodeJS.Platform | null>(null);
  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';

  useAbortableEffect((signal) => {
    void systemBridge.app.platform().then((platform) => {
      if (!signal.aborted) setDesktopPlatform(platform);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeSettings]);

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
              <div className="px-[var(--lc-sidebar-edge,0.5rem)]">
                <ShellSidebarItem onClick={closeSettings}>
                  <ChevronLeftIcon className="size-4" />
                  {t('back')}
                </ShellSidebarItem>

                <div className="relative py-[var(--lc-sidebar-edge,0.5rem)]">
                  <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 text-muted-foreground" />
                  {/* Visual placeholder until settings search is backed by the shared registry. */}
                  <Input
                    aria-label={t('searchPlaceholder')}
                    className="[&_[data-slot=input]]:pl-8"
                    nativeInput
                    placeholder={t('searchPlaceholder')}
                    readOnly
                    type="search"
                  />
                </div>

                <nav className="flex flex-col gap-1">
                  <ShellSidebarItem
                    active={category === 'general'}
                    onClick={() => setCategory('general')}
                  >
                    <SettingsIcon className="size-4" />
                    {t('tabs.general')}
                  </ShellSidebarItem>
                  <ShellSidebarItem
                    active={category === 'connection'}
                    onClick={() => setCategory('connection')}
                  >
                    <WifiIcon className="size-4" />
                    {t('tabs.connection')}
                  </ShellSidebarItem>
                  <ShellSidebarItem
                    active={category === 'about'}
                    onClick={() => setCategory('about')}
                  >
                    <InfoIcon className="size-4" />
                    {t('tabs.about')}
                  </ShellSidebarItem>
                  <ShellSidebarItem
                    active={category === 'agents'}
                    onClick={() => setCategory('agents')}
                  >
                    <BotIcon className="size-4" />
                    {t('tabs.agents')}
                  </ShellSidebarItem>
                </nav>
              </div>
            </ShellSidebar>
          </div>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="min-w-0 flex-1 overflow-y-auto pt-(--lc-chrome-h)">
              <div className="mx-auto max-w-2xl p-6">{renderSettingsPanel(category)}</div>
            </div>
          </main>
        </div>
      </DesktopChrome>
    </div>
  );
}

function renderSettingsPanel(category: SettingsCategory): React.ReactNode {
  switch (category) {
    case 'general':
      return <GeneralTab />;
    case 'connection':
      return <ConnectionTab />;
    case 'about':
      return <AboutTab />;
    case 'agents':
      return <AgentsTab />;
    default:
      return null;
  }
}
