import type { TerminalAttachResult } from '@linkcode/client-core';
import { useLinkCodeClient } from '@linkcode/client-core';
import { LiveTerminal } from '@linkcode/ui/shell/terminal';
import { Button } from 'coss-ui/components/button';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useTerminalPrefsStore } from '../settings/terminal-prefs-store';
import { createTransportTerminalSession } from './transport-session';

/**
 * Read/write view onto a terminal that already exists on the daemon (e.g. a script's log PTY).
 * Unlike {@link TerminalPanel} there is no open/restart lifecycle — the owner controls the
 * process; closing the tab just detaches.
 */
export function AttachedTerminalPanel({
  terminalId,
  onCloseTab,
  interactive,
  primary = true,
  suspended,
}: {
  terminalId: string;
  /** Close through the host action so panel selection/open state follows the shared tab store. */
  onCloseTab: (id: string) => void;
  interactive?: boolean;
  /** Exactly one duplicate surface attaches/detaches the daemon capability. */
  primary?: boolean;
  suspended?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();
  const [controlFailedTerminalId, setControlFailedTerminalId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<
    | { terminalId: string; result: TerminalAttachResult }
    | { terminalId: string; failed: true }
    | null
  >(null);
  const attachedTerminal =
    attachment?.terminalId === terminalId && 'result' in attachment
      ? attachment.result.terminal
      : null;
  const initialCols = attachedTerminal?.cols ?? null;
  const initialRows = attachedTerminal?.rows ?? null;
  const session = useMemo(
    () =>
      createTransportTerminalSession(
        client,
        terminalId,
        initialCols !== null && initialRows !== null
          ? { cols: initialCols, rows: initialRows }
          : null,
      ),
    [client, initialCols, initialRows, terminalId],
  );
  const subscribeController = useCallback(
    (listener: () => void) => client.subscribeTerminalController(terminalId, listener),
    [client, terminalId],
  );
  const canControl = useSyncExternalStore(subscribeController, () =>
    client.terminalCanControl(terminalId),
  );
  const fontFamily = useTerminalPrefsStore((state) => state.fontFamily);
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);

  useAbortableEffect(
    (signal) => {
      if (!primary) return;
      void client
        .attachTerminal(terminalId)
        .then((result) => {
          if (!signal.aborted) setAttachment({ terminalId, result });
        })
        .catch(() => {
          if (!signal.aborted) setAttachment({ terminalId, failed: true });
        });
      // Balance the retain immediately. If attach is still pending, client-core observes the
      // zero retain count when the reply arrives and sends the terminal.detach frame then.
      return () => client.detachTerminal(terminalId);
    },
    [client, terminalId, primary],
  );

  useAbortableEffect(
    (signal) => {
      if (!primary) return;
      return client.subscribeTerminalExit(terminalId, () => {
        if (!signal.aborted) onCloseTab(`attach:${terminalId}`);
      });
    },
    [client, terminalId, onCloseTab, primary],
  );

  if (!primary) {
    return (
      <LiveTerminal
        session={session}
        interactive={false}
        suspended={suspended}
        fontFamily={fontFamily}
        fontSize={fontSize}
        colorScheme={colorScheme}
        className="h-full w-full"
      />
    );
  }

  const current = attachment?.terminalId === terminalId ? attachment : null;
  if (!current || 'failed' in current) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {t(current ? 'terminalFailed' : 'terminalStarting')}
      </div>
    );
  }

  const managed = current.result.terminal.managed;
  const controlFailed = controlFailedTerminalId === terminalId;
  const takeControl = (): void => {
    setControlFailedTerminalId(null);
    void client.takeTerminalControl(terminalId).catch(() => setControlFailedTerminalId(terminalId));
  };

  return (
    <div className="relative h-full w-full">
      <LiveTerminal
        session={session}
        interactive={interactive}
        suspended={suspended}
        fontFamily={fontFamily}
        fontSize={fontSize}
        colorScheme={colorScheme}
        className="h-full w-full"
      />
      {!canControl && (
        <div className="absolute inset-x-0 top-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
            <span className="text-muted-foreground text-sm">
              {t(managed ? 'terminalManagedViewOnly' : 'terminalViewOnly')}
            </span>
            {!managed && (
              <Button variant="outline" size="sm" onClick={takeControl}>
                {t('terminalTakeControl')}
              </Button>
            )}
          </div>
        </div>
      )}
      {controlFailed && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="rounded-md border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
            {t('terminalTakeControlFailed')}
          </div>
        </div>
      )}
    </div>
  );
}
