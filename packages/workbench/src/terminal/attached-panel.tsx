import { useLinkCodeClient } from '@linkcode/client-core';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { useMemo } from 'react';
import { createTransportTerminalSession } from './transport-session';

/**
 * Read/write view onto a terminal that already exists on the daemon (e.g. a workspace
 * script's log PTY). Unlike {@link TerminalPanel} there is no open/restart lifecycle —
 * the owner (the script service) controls the process; closing the tab just detaches.
 */
export function AttachedTerminalPanel({
  terminalId,
  suspended,
}: {
  terminalId: string;
  suspended?: boolean;
}): React.ReactNode {
  const client = useLinkCodeClient();
  const session = useMemo(
    () => createTransportTerminalSession(client, terminalId),
    [client, terminalId],
  );
  return <LiveTerminal session={session} suspended={suspended} className="h-full w-full" />;
}
