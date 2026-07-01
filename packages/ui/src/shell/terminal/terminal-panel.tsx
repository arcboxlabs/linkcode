import { useLinkCodeClient } from '@linkcode/client-core';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useMemo, useState } from 'react';
import { LiveTerminal } from './live-terminal';
import { createTransportTerminalSession } from './session';

/** Daemon-backed interactive shell: opens a terminal and renders it with restty. */
export function TerminalPanel(): React.ReactNode {
  const client = useLinkCodeClient();
  const [terminalId, setTerminalId] = useState<string | null>(null);

  useAbortableEffect(
    (signal) => {
      let opened: string | null = null;
      void client
        .openTerminal({ cols: 80, rows: 24 })
        .then((id) => {
          if (signal.aborted) {
            // Unmounted mid-open — don't leak the host terminal.
            client.closeTerminal(id);
            return;
          }
          opened = id;
          setTerminalId(id);
        })
        // Open failure surfaces via the daemon's request.failed; leave the panel starting.
        .catch(noop);
      return () => {
        if (opened) client.closeTerminal(opened);
      };
    },
    [client],
  );

  // Stable identity per terminal so LiveTerminal's effect doesn't tear down on every render.
  const session = useMemo(
    () => (terminalId ? createTransportTerminalSession(client, terminalId) : null),
    [client, terminalId],
  );

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Starting terminal…
      </div>
    );
  }
  return <LiveTerminal session={session} className="h-full w-full" />;
}
