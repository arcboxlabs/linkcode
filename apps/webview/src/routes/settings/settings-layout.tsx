import { SettingsSidebarNav, ShellSidebar, TitleStrip } from '@linkcode/ui';
import { filterSettingsNavGroups, useSettingsSearchKeywords } from '@linkcode/workbench';
import {
  BellIcon,
  BotIcon,
  KeyRoundIcon,
  SendIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
  WifiIcon,
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
  messaging: '/settings/messaging',
  connection: '/settings/connection',
};

export function SettingsLayout(): React.ReactNode {
  const t = useTranslations('settings');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const searchKeywords = useSettingsSearchKeywords();

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
          active: isActive(pathname, ''),
          render: <Link to="/settings" />,
        },
        {
          key: 'appearance',
          icon: <SunMoonIcon className="size-4" />,
          label: t('tabs.appearance'),
          keywords: searchKeywords.appearance,
          active: isActive(pathname, 'appearance'),
          render: <Link to="/settings/appearance" />,
        },
        {
          key: 'terminal',
          icon: <TerminalIcon className="size-4" />,
          label: t('tabs.terminal'),
          keywords: searchKeywords.terminal,
          active: isActive(pathname, 'terminal'),
          render: <Link to="/settings/terminal" />,
        },
        {
          key: 'notifications',
          icon: <BellIcon className="size-4" />,
          label: t('tabs.notifications'),
          keywords: searchKeywords.notifications,
          active: isActive(pathname, 'notifications'),
          render: <Link to="/settings/notifications" />,
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
          active: isActive(pathname, 'agents'),
          render: <Link to="/settings/agents" />,
        },
        {
          key: 'providers',
          icon: <KeyRoundIcon className="size-4" />,
          label: t('tabs.providers'),
          keywords: searchKeywords.providers,
          active: isActive(pathname, 'providers'),
          render: <Link to="/settings/providers" />,
        },
        {
          key: 'messaging',
          icon: <SendIcon className="size-4" />,
          label: t('tabs.imChannel'),
          keywords: searchKeywords.imChannel,
          active: isActive(pathname, 'messaging'),
          render: <Link to="/settings/messaging" />,
        },
      ],
    },
    {
      key: 'system',
      label: t('groups.system'),
      items: [
        {
          key: 'connection',
          icon: <WifiIcon className="size-4" />,
          label: t('tabs.connection'),
          keywords: searchKeywords.connection,
          active: isActive(pathname, 'connection'),
          render: <Link to="/settings/connection" />,
        },
      ],
    },
  ];
  const visibleGroups = filterSettingsNavGroups(navGroups, searchQuery);

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
              const first = visibleGroups.flatMap((group) => group.items)[0];
              const route = first === undefined ? undefined : SETTINGS_ROUTES[first.key];
              if (route !== undefined) void navigate(route);
            }}
            searchEmptyLabel={t('searchNoResults')}
            groups={visibleGroups}
          />
        </ShellSidebar>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <TitleStrip className="border-border border-b">
          <span className="min-w-0 truncate font-semibold text-sm">{t('title')}</span>
        </TitleStrip>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* The providers page is a master/detail split and needs the extra width. */}
          <div
            className={`mx-auto p-6 ${isActive(pathname, 'providers') ? 'max-w-5xl' : 'max-w-2xl'}`}
          >
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function isActive(
  pathname: string,
  section:
    | ''
    | 'appearance'
    | 'terminal'
    | 'connection'
    | 'notifications'
    | 'providers'
    | 'agents'
    | 'messaging',
): boolean {
  return pathname.replace(/\/$/, '') === `/settings${section ? `/${section}` : ''}`;
}
