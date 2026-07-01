import { ShellSidebar, ShellSidebarItem, TitleStrip } from '@linkcode/ui';
import { Input } from 'coss-ui/components/input';
import { BotIcon, ChevronLeftIcon, SearchIcon, SettingsIcon, WifiIcon } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';

export function SettingsLayout(): React.ReactNode {
  const t = useTranslations('settings');
  const { pathname } = useLocation();

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <ShellSidebar>
          <div className="px-[var(--lc-sidebar-edge,0.5rem)]">
            <ShellSidebarItem render={<Link to="/" />}>
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
              <ShellSidebarItem render={<Link to="/settings" />} active={isActive(pathname, '')}>
                <SettingsIcon className="size-4" />
                {t('tabs.general')}
              </ShellSidebarItem>
              <ShellSidebarItem
                render={<Link to="/settings/connection" />}
                active={isActive(pathname, 'connection')}
              >
                <WifiIcon className="size-4" />
                {t('tabs.connection')}
              </ShellSidebarItem>
              <ShellSidebarItem
                render={<Link to="/settings/agents" />}
                active={isActive(pathname, 'agents')}
              >
                <BotIcon className="size-4" />
                {t('tabs.agents')}
              </ShellSidebarItem>
            </nav>
          </div>
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
