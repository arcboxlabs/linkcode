import type { TerminalReplayEvent } from '@linkcode/schema';
import type { TerminalViewRef } from 'expo-libghostty';
import { TerminalView } from 'expo-libghostty';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useEffect, useImperativeHandle, useRef } from 'react';

export interface TerminalRendererRef {
  events: (events: readonly TerminalReplayEvent[]) => void;
  exit: (code: number | null) => void;
}

export interface TerminalRendererProps {
  ref: React.Ref<TerminalRendererRef>;
  canControl: boolean;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

/**
 * Native ghostty terminal surface (expo-libghostty). The route owns the
 * LinkCode client and attachment; this component only renders PTY bytes and
 * reports input/resizes. The grid always tracks the local layout — a resize
 * by another controller reflows here instead of forcing its cols/rows.
 */
export default function TerminalRenderer({
  ref,
  canControl,
  onInput,
  onResize,
  onReady,
  onError,
}: TerminalRendererProps): React.ReactNode {
  const terminalRef = useRef<TerminalViewRef>(null);
  const canControlRef = useRef(canControl);
  const readyRef = useRef(false);
  const lastGridRef = useRef<{ cols: number; rows: number } | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInputRef.current = onInput;
    onResizeRef.current = onResize;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onError, onInput, onReady, onResize]);

  const reportError = (error: unknown) => {
    onErrorRef.current(extractErrorMessage(error, false) ?? 'Unknown terminal renderer error');
  };

  useImperativeHandle(
    ref,
    () => ({
      events(events) {
        const terminal = terminalRef.current;
        if (!terminal) return;
        for (const event of events) {
          // Remote resizes are not applied: the ghostty grid derives from the
          // local view size, so only 'write' payloads reach the surface.
          if (event.type === 'write') terminal.writeText(event.data).catch(reportError);
        }
      },
      exit(code) {
        terminalRef.current?.finish(code ?? 0).catch(reportError);
      },
    }),
    [],
  );

  useEffect(() => {
    canControlRef.current = canControl;
    // On gaining control, claim the PTY size for the local grid.
    const grid = lastGridRef.current;
    if (canControl && grid) onResizeRef.current(grid.cols, grid.rows);
  }, [canControl]);

  return (
    <TerminalView
      ref={terminalRef}
      style={{ flex: 1 }}
      onInput={({ nativeEvent }) => {
        if (canControlRef.current) onInputRef.current(nativeEvent.text);
      }}
      onResize={({ nativeEvent }) => {
        lastGridRef.current = { cols: nativeEvent.cols, rows: nativeEvent.rows };
        // The first resize marks the ghostty surface as built — writes made
        // before that would be dropped, so replay is gated on readiness.
        if (!readyRef.current) {
          readyRef.current = true;
          onReadyRef.current();
        }
        if (canControlRef.current) onResizeRef.current(nativeEvent.cols, nativeEvent.rows);
      }}
    />
  );
}
