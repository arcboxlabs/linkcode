import { SettingsSidebarNav, ShellSidebar, TitleStrip } from '@linkcode/ui';
import { BotIcon, SettingsIcon, WifiIcon } from 'lucide-react';
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
                key: 'agents',
                icon: <BotIcon className="size-4" />,
                label: t('tabs.agents'),
                active: isActive(pathname, 'agents'),
                render: <Link to="/settings/agents" />,
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
          <div className="mx-auto max-w-2xl p-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function isActive(pathname: string, section: '' | 'connection' | 'agents'): boolean {
  return pathname.replace(/\/$/, '') === `/settings${section ? `/${section}` : ''}`;
}
