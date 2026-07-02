import { useLinkCodeClient } from '@linkcode/client-core';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { Button } from 'coss-ui/components/button';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import type { TerminalSessionLease } from './session-registry';
import { acquireTerminalSession, peekTerminalSnapshot } from './session-registry';

const TERMINAL_INITIAL_SIZE = { cols: 80, rows: 24 };
const INPUT_LOST_BANNER_MS = 4000;

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
  const leaseRef = useRef<TerminalSessionLease | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const lease = acquireTerminalSession(client, sessionKey, TERMINAL_INITIAL_SIZE);
      leaseRef.current = lease;
      const unsubscribe = lease.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        lease.release();
        if (leaseRef.current === lease) leaseRef.current = null;
      };
    },
    [client, sessionKey],
  );
  const snapshot = useSyncExternalStore(subscribe, () => peekTerminalSnapshot(client, sessionKey));

  // Fire-and-forget frames (input/resize) carry no reply; surface a send failure instead of
  // letting typed keystrokes vanish silently.
  const [inputLost, setInputLost] = useState(false);
  const { terminalId } = snapshot;
  useAbortableEffect(() => {
    if (terminalId === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.subscribeTerminalError(terminalId, () => {
      setInputLost(true);
      clearTimeout(timer);
      timer = setTimeout(() => setInputLost(false), INPUT_LOST_BANNER_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, terminalId]);

  const restart = (): void => leaseRef.current?.restart();

  if (snapshot.failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">{t('terminalFailed')}</p>
        <Button variant="outline" size="sm" onClick={restart}>
          {t('terminalRetry')}
        </Button>
      </div>
    );
  }
  if (!snapshot.session) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {t('terminalStarting')}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <LiveTerminal session={snapshot.session} suspended={suspended} className="h-full w-full" />
      {snapshot.exitCode !== null && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
            <span className="text-muted-foreground text-sm">
              {t('terminalExited', { code: snapshot.exitCode })}
            </span>
            <Button variant="outline" size="sm" onClick={restart}>
              {t('terminalRestart')}
            </Button>
          </div>
        </div>
      )}
      {inputLost && snapshot.exitCode === null && (
        <div className="absolute inset-x-0 top-3 flex justify-center">
          <div className="rounded-md border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
            {t('terminalInputLost')}
          </div>
        </div>
      )}
    </div>
  );
}
