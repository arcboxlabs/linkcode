import type { SessionInfo } from '@linkcode/schema';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

const STATUS_COLORS: Record<SessionInfo['status'], string> = {
  starting: 'bg-warning',
  idle: 'bg-muted-foreground/40',
  running: 'bg-info',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/30',
};

export function SessionItem({
  session,
  active,
  onSelect,
  onStop,
}: {
  session: SessionInfo;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
}): ReactNode {
  const t = useTranslations('workbench');
  const title = t(`agentKind.${session.kind}`);
  const subtitle = session.cwd.split('/').findLast(Boolean) ?? session.cwd;
  const statusColor = STATUS_COLORS[session.status];

  return (
    <div
      className={cn(
        'group relative rounded-lg',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 pr-9 text-left',
          active ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground',
        )}
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            statusColor,
            session.status === 'running' && 'animate-pulse',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t('session.stop')}
        onClick={onStop}
        className="-translate-y-1/2 absolute top-1/2 right-1.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
