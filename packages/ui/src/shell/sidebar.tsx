import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { PlusIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useTranslations } from 'use-intl';
import { NewSessionForm } from './new-session-form';
import { SessionList } from './session-list';

export interface SidebarProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
}

/** The session inbox: header + new-session affordance + scrollable list. */
export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onStop,
  onCreate,
}: SidebarProps): ReactElement {
  const t = useTranslations('workbench.sidebar');
  const [creating, setCreating] = useState(false);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-semibold text-[12px] text-sidebar-foreground uppercase tracking-wide">
          {t('title')}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('newSession')}
          onClick={() => setCreating((v) => !v)}
        >
          <PlusIcon />
        </Button>
      </div>
      {creating && (
        <div className="px-2 pb-2">
          <NewSessionForm
            onCreate={(opts) => {
              onCreate(opts);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <SessionList sessions={sessions} activeId={activeId} onSelect={onSelect} onStop={onStop} />
      </div>
    </aside>
  );
}
