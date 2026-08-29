import { SettingsPageTitle, SettingsSidebarNav, ShellSidebar } from '@linkcode/ui';
import { filterSettingsNavGroups, useSettingsSearchKeywords } from '@linkcode/workbench';
import {
  BellIcon,
  BotIcon,
  CodeXmlIcon,
  CreditCardIcon,
  KeyRoundIcon,
  PuzzleIcon,
  SendIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

const SETTINGS_ROUTES: Record<string, string> = {
  general: '/settings',
  appearance: '/settings/appearance',
  terminal: '/settings/terminal',
  notifications: '/settings/notifications',
  agents: '/settings/agents',
  providers: '/settings/providers',
  billing: '/settings/billing',
  plugins: '/settings/plugins',
  messaging: '/settings/messaging',
  developer: '/settings/developer',
};
// One table for the sidebar items and the page header — a tab whose message key differs
// from its route key (messaging → imChannel) stays consistent in both by construction.
const SETTINGS_TAB_LABEL_KEYS: Record<string, string> = {
  general: 'tabs.general',
  appearance: 'tabs.appearance',
  terminal: 'tabs.terminal',
  notifications: 'tabs.notifications',
  billing: 'tabs.billing',
  agents: 'tabs.agents',
  providers: 'tabs.providers',
  plugins: 'tabs.plugins',
  messaging: 'tabs.imChannel',
  developer: 'tabs.developer',
};
const RE_TRAILING_SLASH = /\/$/;
// Inverted once at module scope: the active tab is a single O(1) lookup per navigation.
const SETTINGS_TAB_BY_PATH = new Map(
  Object.entries(SETTINGS_ROUTES).map(([key, route]) => [route, key]),
);

export function SettingsLayout(): React.ReactNode {
  const t = useTranslations('settings');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const searchKeywords = useSettingsSearchKeywords();
  const activeKey = SETTINGS_TAB_BY_PATH.get(pathname.replace(RE_TRAILING_SLASH, ''));

  const navGroups = [
    {
      key: 'personal',
      label: t('groups.personal'),
      items: [
        {
          key: 'general',
          icon: <SettingsIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.general),
          keywords: searchKeywords.general,
          active: activeKey === 'general',
          render: <Link to="/settings" />,
        },
        {
          key: 'appearance',
          icon: <SunMoonIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.appearance),
          keywords: searchKeywords.appearance,
          active: activeKey === 'appearance',
          render: <Link to="/settings/appearance" />,
        },
        {
          key: 'terminal',
          icon: <TerminalIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.terminal),
          keywords: searchKeywords.terminal,
          active: activeKey === 'terminal',
          render: <Link to="/settings/terminal" />,
        },
        {
          key: 'notifications',
          icon: <BellIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.notifications),
          keywords: searchKeywords.notifications,
          active: activeKey === 'notifications',
          render: <Link to="/settings/notifications" />,
        },
        {
          key: 'billing',
          icon: <CreditCardIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.billing),
          keywords: searchKeywords.billing,
          active: activeKey === 'billing',
          render: <Link to="/settings/billing" />,
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
          label: t(SETTINGS_TAB_LABEL_KEYS.agents),
          keywords: searchKeywords.agents,
          active: activeKey === 'agents',
          render: <Link to="/settings/agents" />,
        },
        {
          key: 'providers',
          icon: <KeyRoundIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.providers),
          keywords: searchKeywords.providers,
          active: activeKey === 'providers',
          render: <Link to="/settings/providers" />,
        },
        {
          key: 'plugins',
          icon: <PuzzleIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.plugins),
          keywords: searchKeywords.plugins,
          active: activeKey === 'plugins',
          render: <Link to="/settings/plugins" />,
        },
        {
          key: 'messaging',
          icon: <SendIcon className="size-4" />,
          label: t(SETTINGS_TAB_LABEL_KEYS.messaging),
          keywords: searchKeywords.imChannel,
          active: activeKey === 'messaging',
          render: <Link to="/settings/messaging" />,
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
          label: t(SETTINGS_TAB_LABEL_KEYS.developer),
          keywords: searchKeywords.developer,
          active: activeKey === 'developer',
          render: <Link to="/settings/developer" />,
        },
      ],
    },
  ];
  const visibleGroups = filterSettingsNavGroups(navGroups, searchQuery);
  const activeLabel = activeKey === undefined ? undefined : t(SETTINGS_TAB_LABEL_KEYS[activeKey]);

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <ShellSidebar>
          <SettingsSidebarNav
            backLabel={t('back')}
            backRender={<Link to="/" />}
            searchPlaceholder={t('searchPlaceholder')}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={() => {
              const first = visibleGroups.flatMap((group) => group.items).at(0);
              if (first !== undefined) void navigate(SETTINGS_ROUTES[first.key]);
            }}
            searchEmptyLabel={t('searchNoResults')}
            groups={visibleGroups}
          />
        </ShellSidebar>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            {activeLabel === undefined ? null : (
              <SettingsPageTitle>{activeLabel}</SettingsPageTitle>
            )}
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
