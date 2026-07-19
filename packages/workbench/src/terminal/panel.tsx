import { useLinkCodeClient } from '@linkcode/client-core';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { Button } from 'coss-ui/components/button';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useTerminalPrefsStore } from '../settings/terminal-prefs-store';
import type { TerminalSessionLease } from './session-registry';
import { acquireTerminalSession, peekTerminalSnapshot } from './session-registry';

const TERMINAL_INITIAL_SIZE = { cols: 80, rows: 24 };
const INPUT_LOST_BANNER_MS = 4000;

/**
 * Daemon-backed interactive shell keyed by `sessionKey`, rendered with restty. The PTY lives in
 * the session registry (an external store), so remounts such as the docked↔maximized panel
 * handoff reattach to the same terminal instead of spawning a new one.
 */
export function TerminalPanel({
  sessionKey,
  cwd,
  interactive,
  suspended,
}: {
  sessionKey: string;
  /** Working directory for the shell, captured when the terminal first opens (host home if omitted). */
  cwd?: string;
  interactive?: boolean;
  /** Freeze the terminal's box while the host panel animates shut/open — see {@link LiveTerminal}. */
  suspended?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();
  const leaseRef = useRef<TerminalSessionLease | null>(null);
  const inputLostTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fontFamily = useTerminalPrefsStore((state) => state.fontFamily);
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const lease = acquireTerminalSession(client, sessionKey, { ...TERMINAL_INITIAL_SIZE, cwd });
      leaseRef.current = lease;
      const unsubscribe = lease.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        lease.release();
        if (leaseRef.current === lease) leaseRef.current = null;
      };
    },
    [client, sessionKey, cwd],
  );
  const snapshot = useSyncExternalStore(subscribe, () => peekTerminalSnapshot(client, sessionKey));

  // Fire-and-forget frames (input/resize) carry no reply; surface a send failure instead of
  // letting typed keystrokes vanish silently.
  const [inputLost, setInputLost] = useState(false);
  const { terminalId } = snapshot;
  useAbortableEffect(() => {
    if (terminalId === null) return;
    const unsubscribe = client.subscribeTerminalError(terminalId, () => {
      setInputLost(true);
      clearTimeout(inputLostTimerRef.current);
      inputLostTimerRef.current = setTimeout(() => setInputLost(false), INPUT_LOST_BANNER_MS);
    });
    return () => {
      clearTimeout(inputLostTimerRef.current);
      inputLostTimerRef.current = undefined;
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
  const takeControl = (): void => {
    if (terminalId === null) return;
    void client.takeTerminalControl(terminalId).catch(() => {
      setInputLost(true);
      clearTimeout(inputLostTimerRef.current);
      inputLostTimerRef.current = setTimeout(() => setInputLost(false), INPUT_LOST_BANNER_MS);
    });
  };
  return (
    <div className="relative h-full w-full">
      <LiveTerminal
        session={snapshot.session}
        interactive={interactive}
        suspended={suspended}
        fontFamily={fontFamily}
        fontSize={fontSize}
        colorScheme={colorScheme}
        className="h-full w-full"
      />
      {snapshot.exit !== null && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
            <span className="text-muted-foreground text-sm">
              {snapshot.exit.code === null
                ? t('terminalExitedSignal')
                : t('terminalExited', { code: snapshot.exit.code })}
            </span>
            <Button variant="outline" size="sm" onClick={restart}>
              {t('terminalRestart')}
            </Button>
          </div>
        </div>
      )}
      {!snapshot.canControl && snapshot.exit === null && (
        <div className="absolute inset-x-0 top-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
            <span className="text-muted-foreground text-sm">{t('terminalViewOnly')}</span>
            <Button variant="outline" size="sm" onClick={takeControl}>
              {t('terminalTakeControl')}
            </Button>
          </div>
        </div>
      )}
      {inputLost && snapshot.exit === null && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="rounded-md border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
            {t('terminalInputLost')}
          </div>
        </div>
      )}
    </div>
  );
}
