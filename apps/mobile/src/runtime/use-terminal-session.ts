import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalId, TerminalMetadata, TerminalReplayEvent } from '@linkcode/schema';
import type { TerminalRendererRef } from '@mobile/components/terminal/terminal-renderer.types';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useRef, useState } from 'react';

export type TerminalAttachStatus = 'attaching' | 'ready' | 'error';

export interface TerminalSession {
  /** Callback ref for the rendering surface. A callback, not a `RefObject`, so the hook stays the
   * sole owner of the instance — handing a ref object out would taint every read of this result
   * for `react-hooks/refs`. */
  readonly setRenderer: (instance: TerminalRendererRef | null) => void;
  readonly status: TerminalAttachStatus;
  readonly terminal: TerminalMetadata | null;
  readonly canControl: boolean;
  readonly takingControl: boolean;
  readonly truncated: boolean;
  /** Host-reported failure, already flattened to a message. */
  readonly error: string | null;
  readonly exit: { code: number | null } | null;
  readonly onInput: (data: string) => void;
  readonly onResize: (cols: number, rows: number) => void;
  readonly onRendererReady: () => void;
  readonly onRendererError: (message: string) => void;
  readonly takeControl: () => void;
  readonly close: () => void;
  /** Re-run the whole attach; a null `terminalId` is not recoverable here, the caller navigates. */
  readonly retry: () => void;
}

/** Attachment lifecycle for one host-owned PTY: subscribe, attach, optionally take control, then
 * feed the ghostty surface. The renderer ref lives here because replay events must be buffered
 * until the surface reports ready and then delivered imperatively. A null `terminalId` starts in
 * `error` with no message — the caller owns that copy, since only it knows the id was unparseable. */
export function useTerminalSession(
  terminalId: TerminalId | null,
  autoTakeControl: boolean,
): TerminalSession {
  const client = useLinkCodeClient();
  const rendererRef = useRef<TerminalRendererRef | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<TerminalAttachStatus>(terminalId ? 'attaching' : 'error');
  const [terminal, setTerminal] = useState<TerminalMetadata | null>(null);
  const [canControl, setCanControl] = useState(false);
  const [takingControl, setTakingControl] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exit, setExit] = useState<{ code: number | null } | null>(null);
  const [rendererGeneration, setRendererGeneration] = useState(0);

  useEffect(
    (signal) => {
      if (!terminalId) return;
      const offController = client.subscribeTerminalController(terminalId, (controlled) => {
        if (!signal.aborted) setCanControl(controlled);
      });
      const offExit = client.subscribeTerminalExit(terminalId, (code) => {
        if (signal.aborted) return;
        setExit({ code });
        setCanControl(false);
      });
      const offError = client.subscribeTerminalError(terminalId, (cause) => {
        if (!signal.aborted) setError(cause.message);
      });
      const offReplayTruncated = client.subscribeTerminalReplayTruncated(
        terminalId,
        (wasTruncated) => {
          if (!signal.aborted) setTruncated(wasTruncated);
        },
      );

      void (async () => {
        try {
          const result = await client.attachTerminal(terminalId);
          if (signal.aborted) return;
          setTerminal(result.terminal);
          setTruncated(result.truncated);
          setCanControl(client.terminalCanControl(terminalId));
          setStatus('ready');

          if (autoTakeControl && !result.terminal.managed) {
            setTakingControl(true);
            try {
              const controlled = await client.takeTerminalControl(terminalId);
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (signal.aborted) return;
              setTruncated((current) => current || controlled.truncated);
              setCanControl(client.terminalCanControl(terminalId));
            } catch (error_) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (!signal.aborted) {
                setError(extractErrorMessage(error_, false) ?? 'Unknown error');
              }
            } finally {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (!signal.aborted) setTakingControl(false);
            }
          }
        } catch (error_) {
          if (signal.aborted) return;
          setError(extractErrorMessage(error_, false) ?? 'Unknown error');
          setStatus('error');
        }
      })();

      return () => {
        offController();
        offExit();
        offError();
        offReplayTruncated();
        client.detachTerminal(terminalId);
      };
    },
    [attempt, autoTakeControl, client, terminalId],
  );

  useEffect(() => {
    if (rendererGeneration === 0 || status !== 'ready' || !terminalId) return;

    const deliver = (events: readonly TerminalReplayEvent[]) => {
      rendererRef.current?.events(events);
    };
    let replaying = true;
    const replay: TerminalReplayEvent[] = [];
    const unsubscribe = client.subscribeTerminalEvents(terminalId, (event) => {
      if (replaying) {
        replay.push(event);
        return;
      }
      deliver([event]);
    });
    replaying = false;
    deliver(replay);
    return unsubscribe;
  }, [client, rendererGeneration, status, terminalId]);

  useEffect(() => {
    if (rendererGeneration === 0 || !exit) return;
    rendererRef.current?.exit(exit.code);
  }, [exit, rendererGeneration]);

  const onInput = useCallback(
    (data: string) => {
      if (terminalId) client.terminalInput(terminalId, data);
    },
    [client, terminalId],
  );
  const onResize = useCallback(
    (cols: number, rows: number) => {
      if (terminalId) client.resizeTerminal(terminalId, cols, rows);
    },
    [client, terminalId],
  );
  const setRenderer = useCallback((instance: TerminalRendererRef | null) => {
    rendererRef.current = instance;
  }, []);
  const onRendererReady = useCallback(() => {
    setRendererGeneration((current) => current + 1);
  }, []);
  const onRendererError = useCallback((message: string) => {
    setError(message);
  }, []);

  const takeControl = useCallback(() => {
    if (!terminalId || takingControl) return;
    setTakingControl(true);
    setError(null);
    void (async () => {
      try {
        const result = await client.takeTerminalControl(terminalId);
        setTruncated((current) => current || result.truncated);
        setCanControl(client.terminalCanControl(terminalId));
      } catch (error_) {
        setError(extractErrorMessage(error_, false) ?? 'Unknown error');
      } finally {
        setTakingControl(false);
      }
    })();
  }, [client, takingControl, terminalId]);

  const close = useCallback(() => {
    if (terminalId) client.closeTerminal(terminalId);
  }, [client, terminalId]);

  const retry = useCallback(() => {
    if (!terminalId) return;
    setStatus('attaching');
    setError(null);
    setExit(null);
    setTerminal(null);
    setCanControl(false);
    setTakingControl(false);
    setTruncated(false);
    setRendererGeneration(0);
    setAttempt((current) => current + 1);
  }, [terminalId]);

  return {
    setRenderer,
    status,
    terminal,
    canControl,
    takingControl,
    truncated,
    error,
    exit,
    onInput,
    onResize,
    onRendererReady,
    onRendererError,
    takeControl,
    close,
    retry,
  };
}
