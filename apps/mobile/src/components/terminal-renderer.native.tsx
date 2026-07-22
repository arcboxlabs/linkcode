import type { TerminalViewRef } from 'expo-libghostty';
import { TerminalView } from 'expo-libghostty';
import { useStableHandler } from 'foxact/use-stable-handler-only-when-you-know-what-you-are-doing-or-you-will-be-fired';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';
import type { TerminalRendererProps } from './terminal-renderer.types';

/**
 * Native ghostty terminal surface (expo-libghostty). The route owns the
 * LinkCode client and attachment; this component only renders PTY bytes and
 * reports input/resizes. The grid always tracks the local layout — a resize
 * by another controller reflows here instead of forcing its cols/rows.
 */
export default function TerminalRenderer({
  ref,
  canControl,
  fontSize,
  theme,
  onInput,
  onResize,
  onReady,
  onError,
}: TerminalRendererProps): React.ReactNode {
  const terminalRef = useRef<TerminalViewRef>(null);
  const readyRef = useRef(false);
  const lastGridRef = useRef<{ cols: number; rows: number } | null>(null);

  const handleResize = useEffectEvent(onResize);
  const handleError = useStableHandler(onError);

  const reportError = useCallback((error: unknown) => {
    handleError(extractErrorMessage(error, false) ?? 'Unknown terminal renderer error');
  }, [handleError]);

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
    [reportError],
  );

  useEffect(() => {
    // On gaining control, claim the PTY size for the local grid.
    const grid = lastGridRef.current;
    if (canControl && grid) handleResize(grid.cols, grid.rows);
  }, [canControl]);

  return (
    <TerminalView
      ref={terminalRef}
      style={{ flex: 1 }}
      fontSize={fontSize}
      theme={theme}
      onInput={({ nativeEvent }) => {
        if (canControl) onInput(nativeEvent.text);
      }}
      onResize={({ nativeEvent }) => {
        lastGridRef.current = { cols: nativeEvent.cols, rows: nativeEvent.rows };
        // The first resize marks the ghostty surface as built — writes made
        // before that would be dropped, so replay is gated on readiness.
        if (!readyRef.current) {
          readyRef.current = true;
          onReady();
        }
        if (canControl) onResize(nativeEvent.cols, nativeEvent.rows);
      }}
    />
  );
}
