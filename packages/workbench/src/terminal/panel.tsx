import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { acquireTerminalSession, peekTerminalSession } from './session-registry';

const TERMINAL_INITIAL_SIZE = { cols: 80, rows: 24 };

/**
 * Daemon-backed interactive shell: attaches to the host terminal keyed by `sessionKey`
 * (opening it on first mount) and renders it with restty. The PTY lives in the session
 * registry, so remounts — e.g. the docked↔maximized panel handoff — reattach to the same
 * terminal instead of spawning a new one.
 */
export function TerminalPanel({ sessionKey }: { sessionKey: string }): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();
  const [session, setSession] = useState<TerminalSession | null>(() =>
    peekTerminalSession(client, sessionKey),
  );

  useEffect(() => {
    const lease = acquireTerminalSession(client, sessionKey, TERMINAL_INITIAL_SIZE);
    setSession(lease.getSession());
    const unsubscribe = lease.subscribe(() => setSession(lease.getSession()));
    return () => {
      unsubscribe();
      lease.release();
    };
  }, [client, sessionKey]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {t('terminalStarting')}
      </div>
    );
  }
  return <LiveTerminal session={session} className="h-full w-full" />;
}
