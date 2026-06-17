import type { SessionId, SessionInfo } from '@linkcode/schema';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';
import { SessionItem } from './SessionItem';

export interface SessionListProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
}

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onStop,
}: SessionListProps): ReactElement {
  const t = useTranslations('workbench.sidebar');

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">{t('empty')}</div>
    );
  }

  return (
    <div className="space-y-0.5 px-2">
      {sessions.map((session) => (
        <SessionItem
          key={session.sessionId}
          session={session}
          active={session.sessionId === activeId}
          onSelect={() => onSelect(session.sessionId)}
          onStop={() => onStop(session.sessionId)}
        />
      ))}
    </div>
  );
}
