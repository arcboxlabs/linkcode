import { SettingsSidebarNav, ShellSidebar, TitleStrip } from '@linkcode/ui';
import { BellIcon, BotIcon, KeyRoundIcon, SendIcon, SettingsIcon, WifiIcon } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';

export function SettingsLayout(): React.ReactNode {
  const t = useTranslations('settings');
  const { pathname } = useLocation();

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <ShellSidebar>
          <SettingsSidebarNav
            backLabel={t('back')}
            backRender={<Link to="/" />}
            searchPlaceholder={t('searchPlaceholder')}
            items={[
              {
                key: 'general',
                icon: <SettingsIcon className="size-4" />,
                label: t('tabs.general'),
                active: isActive(pathname, ''),
                render: <Link to="/settings" />,
              },
              {
                key: 'connection',
                icon: <WifiIcon className="size-4" />,
                label: t('tabs.connection'),
                active: isActive(pathname, 'connection'),
                render: <Link to="/settings/connection" />,
              },
              {
                key: 'notifications',
                icon: <BellIcon className="size-4" />,
                label: t('tabs.notifications'),
                active: isActive(pathname, 'notifications'),
                render: <Link to="/settings/notifications" />,
              },
              {
                key: 'providers',
                icon: <KeyRoundIcon className="size-4" />,
                label: t('tabs.providers'),
                active: isActive(pathname, 'providers'),
                render: <Link to="/settings/providers" />,
              },
              {
                key: 'agents',
                icon: <BotIcon className="size-4" />,
                label: t('tabs.agents'),
                active: isActive(pathname, 'agents'),
                render: <Link to="/settings/agents" />,
              },
              {
                key: 'messaging',
                icon: <SendIcon className="size-4" />,
                label: t('tabs.imChannel'),
                active: isActive(pathname, 'messaging'),
                render: <Link to="/settings/messaging" />,
              },
            ]}
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
  section: '' | 'connection' | 'notifications' | 'providers' | 'agents' | 'messaging',
): boolean {
  return pathname.replace(/\/$/, '') === `/settings${section ? `/${section}` : ''}`;
}
