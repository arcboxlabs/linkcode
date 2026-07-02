import type { SessionInfo, SessionStatus } from '@linkcode/schema';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { AGENT_LABELS, AgentIcon } from '../agent-icon';
import { relativeTimeLabel } from '../relative-time';
import { repositoryLabel } from '../repository-label';

const STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-info',
  idle: 'bg-muted-foreground/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/25',
};

export interface ThreadRowProps {
  session: SessionInfo;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
}

/** One thread row: agent icon, single-line title, status dot. The relative time lives in a tooltip. */
export function ThreadRow({ session, active, onSelect, onStop }: ThreadRowProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const agent = AGENT_LABELS[session.kind];
  const title = session.title ?? `${agent} in ${repositoryLabel(session.cwd)}`;

  return (
    <div
      className={cn(
        'group relative rounded-md',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/70',
      )}
    >
      {active && (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <button
        type="button"
        title={relativeTimeLabel(session.createdAt)}
        className="flex h-7 w-full min-w-0 items-center gap-[var(--lc-sidebar-gap,0.5rem)] rounded-md px-[var(--lc-sidebar-edge,0.5rem)] pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="relative shrink-0">
          <AgentIcon kind={session.kind} />
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar',
              STATUS_DOT_CLASS[session.status],
            )}
          />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{title}</span>
      </button>
      <button
        type="button"
        aria-label={t('stopThread')}
        title={t('stopThread')}
        onClick={onStop}
        className="-translate-y-1/2 absolute top-1/2 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
