import { useLinkCodeClient } from '@linkcode/client-core';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { acquireTerminalSession, peekTerminalSession } from './session-registry';

const TERMINAL_INITIAL_SIZE = { cols: 80, rows: 24 };

/**
 * Daemon-backed interactive shell: attaches to the host terminal keyed by `sessionKey`
 * (opening it on first mount) and renders it with restty. The PTY lives in the session
 * registry — an external store — so remounts such as the docked↔maximized panel handoff
 * reattach to the same terminal instead of spawning a new one.
 */
export function TerminalPanel({
  sessionKey,
  suspended,
}: {
  sessionKey: string;
  /** Freeze the terminal's box while the host panel animates shut/open — see {@link LiveTerminal}. */
  suspended?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const lease = acquireTerminalSession(client, sessionKey, TERMINAL_INITIAL_SIZE);
      const unsubscribe = lease.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        lease.release();
      };
    },
    [client, sessionKey],
  );
  const session = useSyncExternalStore(subscribe, () => peekTerminalSession(client, sessionKey));

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {t('terminalStarting')}
      </div>
    );
  }
  return <LiveTerminal session={session} suspended={suspended} className="h-full w-full" />;
}
