import { cn } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

export function SettingsLayout(): ReactNode {
  const t = useTranslations('settings');
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4">
        <Button size="sm" variant="ghost" onClick={() => navigate('/')}>
          <ChevronLeftIcon />
          {t('back')}
        </Button>
        <span className="font-semibold text-sm">{t('title')}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-border border-r p-3">
          <SettingsTab to="/settings" end label={t('tabs.general')} />
          <SettingsTab to="/settings/connection" label={t('tabs.connection')} />
          <SettingsTab to="/settings/agents" label={t('tabs.agents')} />
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ to, end, label }: { to: string; end?: boolean; label: string }): ReactNode {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 font-medium text-sm',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50',
        )
      }
    >
      {label}
    </NavLink>
  );
}
