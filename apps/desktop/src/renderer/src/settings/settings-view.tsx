import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  AgentIcon,
  SettingsPageTitle,
  SettingsSidebarNav,
  ShellSidebar,
  useKeyboardShortcut,
} from '@linkcode/ui';
import {
  filterSettingsNavGroups,
  useNavigationHistoryStore,
  useSettingsSearchKeywords,
} from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import {
  BellIcon,
  BotIcon,
  CodeXmlIcon,
  HistoryIcon,
  InfoIcon,
  KeyRoundIcon,
  SendIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';
import { DesktopChrome } from '../shell/chrome/chrome';
import { DESKTOP_CHROME_METRICS_STYLE, DESKTOP_CHROME_SPACER_CLASS } from '../shell/chrome/metrics';
import type { DesktopShellStyle } from '../shell/layout/shell-style';
import { DEFAULT_LAYOUT } from '../shell/store/model';
import { AboutTab } from './about-tab';
import { AgentsTab } from './agents-tab';
import { AppearanceTab } from './appearance-tab';
import { DeveloperTab } from './developer-tab';
import { GeneralTab } from './general-tab';
import { HistoryImportTab } from './history-import-tab';
import { ImChannelTab } from './im-channel-tab';
import { NotificationsTab } from './notifications-tab';
import { ProvidersTab } from './providers-tab';
import type { SettingsCategory } from './store';
import { useDesktopSettingsStore } from './store';
import { TerminalTab } from './terminal-tab';

const AGENT_KINDS: readonly AgentKind[] = AgentKindSchema.options;
const DEFAULT_HISTORY_PROVIDER: AgentKind = 'claude-code';
const CLOSE_SETTINGS_SHORTCUT = { key: 'Escape' } as const;

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
  const [searchQuery, setSearchQuery] = useState('');
  const searchKeywords = useSettingsSearchKeywords();
  const settingsRootRef = useRef<HTMLDivElement>(null);
  const desktopPlatform = systemBridge.app.platform;
  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';
  const showWindowControls = desktopPlatform !== 'darwin';

  useKeyboardShortcut({
    actionId: 'desktop.close-settings',
    shortcut: CLOSE_SETTINGS_SHORTCUT,
    owner: settingsRootRef,
    handler() {
      backFromOverlay();
      return true;
    },
  });

  const navGroups = [
    {
      key: 'personal',
      label: t('groups.personal'),
      items: [
        {
          key: 'general',
          icon: <SettingsIcon className="size-4" />,
          label: t('tabs.general'),
          keywords: searchKeywords.general,
          active: category === 'general',
          onClick: () => setCategory('general'),
        },
        {
          key: 'appearance',
          icon: <SunMoonIcon className="size-4" />,
          label: t('tabs.appearance'),
          keywords: searchKeywords.appearance,
          active: category === 'appearance',
          onClick: () => setCategory('appearance'),
        },
        {
          key: 'terminal',
          icon: <TerminalIcon className="size-4" />,
          label: t('tabs.terminal'),
          keywords: searchKeywords.terminal,
          active: category === 'terminal',
          onClick: () => setCategory('terminal'),
        },
        {
          key: 'notifications',
          icon: <BellIcon className="size-4" />,
          label: t('tabs.notifications'),
          keywords: searchKeywords.notifications,
          active: category === 'notifications',
          onClick: () => setCategory('notifications'),
        },
      ],
    },
    {
      key: 'integrations',
      label: t('groups.integrations'),
      items: [
        {
          key: 'agents',
          icon: <BotIcon className="size-4" />,
          label: t('tabs.agents'),
          keywords: searchKeywords.agents,
          active: category === 'agents',
          onClick: () => setCategory('agents'),
        },
        {
          key: 'providers',
          icon: <KeyRoundIcon className="size-4" />,
          label: t('tabs.providers'),
          keywords: searchKeywords.providers,
          active: category === 'providers',
          onClick: () => setCategory('providers'),
        },
        {
          key: 'imChannel',
          icon: <SendIcon className="size-4" />,
          label: t('tabs.imChannel'),
          keywords: searchKeywords.imChannel,
          active: category === 'imChannel',
          onClick: () => setCategory('imChannel'),
        },
        {
          key: 'history-import',
          icon: <HistoryIcon className="size-4" />,
          label: t('historyImport.portalLabel'),
          keywords: [
            ...searchKeywords.historyImport,
            ...AGENT_KINDS.map((agentKind) => AGENT_LABELS[agentKind]),
          ],
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
      ],
    },
    {
      key: 'system',
      label: t('groups.system'),
      items: [
        {
          key: 'developer',
          icon: <CodeXmlIcon className="size-4" />,
          label: t('tabs.developer'),
          keywords: searchKeywords.developer,
          active: category === 'developer',
          onClick: () => setCategory('developer'),
        },
        {
          key: 'about',
          icon: <InfoIcon className="size-4" />,
          label: t('tabs.about'),
          keywords: searchKeywords.about,
          active: category === 'about',
          onClick: () => setCategory('about'),
        },
      ],
    },
  ];
  const visibleGroups = filterSettingsNavGroups(navGroups, searchQuery);

  return (
    <div
      ref={settingsRootRef}
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
        // The active panel is named by the large heading in the content column below, so the chrome
        // title area stays empty. History import still portals its own toolbar header here.
        titleContent={null}
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
                backAutoFocus
                onBack={backFromOverlay}
                searchPlaceholder={t('searchPlaceholder')}
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={() => {
                  const first = visibleGroups.flatMap((group) => group.items)[0];
                  if (first === undefined) return;
                  // A query that matched an accordion child by name lands on that child, not
                  // the parent's default selection ("codex" → History import → Codex).
                  const query = searchQuery.trim().toLowerCase();
                  const child = first.children?.find((item) =>
                    item.label.toLowerCase().includes(query),
                  );
                  (child ?? first).onClick?.();
                }}
                searchEmptyLabel={t('searchNoResults')}
                groups={visibleGroups}
              />
            </ShellSidebar>
          </div>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="min-w-0 flex-1 overflow-y-auto pt-(--lc-chrome-h)">
              <div className="mx-auto max-w-2xl p-6">
                {/* History import portals its own chrome header, so it owns its title. */}
                {category === 'history-import' ? null : (
                  <SettingsPageTitle>{t(`tabs.${category}`)}</SettingsPageTitle>
                )}
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
    case 'appearance':
      return <AppearanceTab />;
    case 'terminal':
      return <TerminalTab />;
    case 'developer':
      return <DeveloperTab />;
    case 'notifications':
      return <NotificationsTab />;
    case 'about':
      return <AboutTab />;
    case 'providers':
      return <ProvidersTab />;
    case 'agents':
      return <AgentsTab />;
    case 'imChannel':
      return <ImChannelTab />;
    case 'history-import':
      return <HistoryImportTab kind={historyProvider} />;
    default:
      return null;
  }
}
