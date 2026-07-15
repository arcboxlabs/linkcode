'use dom';

import regularFontUrl from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2';
import boldFontUrl from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2';
import type { DOMImperativeFactory, DOMProps } from 'expo/dom';
import { useDOMImperativeHandle } from 'expo/dom';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useEffect, useRef } from 'react';
import type { PtyCallbacks, PtyTransport, ResttyFontInput } from 'restty';
import { getBuiltinTheme, Restty } from 'restty';
import type { TerminalRendererEvent } from './terminal-events';

type DOMImperativeMethod = DOMImperativeFactory[string];
type DOMImperativeValue = Parameters<DOMImperativeMethod>[0];

export interface TerminalRendererRef extends DOMImperativeFactory {
  events: DOMImperativeMethod;
  exit: DOMImperativeMethod;
}

export interface TerminalRendererProps {
  ref: React.Ref<TerminalRendererRef>;
  initialCols: number;
  initialRows: number;
  canControl: boolean;
  onInput: (data: string) => Promise<void>;
  onResize: (cols: number, rows: number) => Promise<void>;
  onReady: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  // eslint-disable-next-line @eslint-react/no-unused-props -- Expo consumes this native-only wrapper prop.
  dom?: DOMProps;
}

const STYLES = `
  html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #0d1117; }
  * { box-sizing: border-box; }
  #frame { width: 100%; height: 100%; padding: 8px; }
  #terminal { width: 100%; height: 100%; }
`;

const TERMINAL_FONTS = [
  { url: regularFontUrl, name: 'IBM Plex Mono', weight: 400 },
  { url: boldFontUrl, name: 'IBM Plex Mono Bold', weight: 700 },
] satisfies ResttyFontInput[];

/** DOM-only Restty surface. The native route owns the LinkCode client and attachment. */
export default function TerminalRenderer({
  ref,
  initialCols,
  initialRows,
  canControl,
  onInput,
  onResize,
  onReady,
  onError,
}: TerminalRendererProps): React.ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Restty | null>(null);
  const callbacksRef = useRef<PtyCallbacks | null>(null);
  const canControlRef = useRef(canControl);
  const applyingRemoteResizeRef = useRef(false);
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

  useDOMImperativeHandle(
    ref,
    () => ({
      events(...args) {
        if (args.length !== 1 || !Array.isArray(args[0])) {
          throw new TypeError('Terminal events must be an array');
        }
        const events: TerminalRendererEvent[] = [];
        for (const event of args[0]) {
          assertTerminalRendererEvent(event);
          events.push(event);
        }
        for (const event of events) {
          if (event[0] === 'w') callbacksRef.current?.onData?.(event[1]);
          else {
            applyRemoteResize(terminalRef.current, applyingRemoteResizeRef, event[1], event[2]);
          }
        }
      },
      exit(...args) {
        const [code] = args;
        if (code !== null && typeof code !== 'number') {
          throw new TypeError('Terminal exit code must be numeric or null');
        }
        callbacksRef.current?.onExit?.(code ?? 0);
      },
    }),
    [],
  );

  useEffect(() => {
    canControlRef.current = canControl;
    if (canControl) terminalRef.current?.updateSize(true);
  }, [canControl]);

  useAbortableEffect(
    (signal) => {
      const root = rootRef.current;
      if (!root) return;

      let connected = false;
      const ptyTransport: PtyTransport = {
        connect({ callbacks }) {
          callbacksRef.current = callbacks;
          connected = true;
          callbacks.onConnect?.();
        },
        disconnect() {
          connected = false;
          callbacksRef.current = null;
        },
        sendInput(data) {
          if (canControlRef.current) void onInputRef.current(data);
          return true;
        },
        resize(cols, rows) {
          if (canControlRef.current && !applyingRemoteResizeRef.current) {
            void onResizeRef.current(cols, rows);
          }
          return true;
        },
        isConnected: () => connected,
      };

      const terminal = new Restty({
        root,
        surface: { autoInit: false, shortcuts: false },
        terminal: {
          autoResize: false,
          fonts: TERMINAL_FONTS,
          forwardTerminalReplies: false,
          theme: getBuiltinTheme('Dark+') ?? undefined,
          touchSelectionMode: 'long-press',
        },
        services: {
          beforeInput: () => (canControlRef.current ? undefined : null),
          ptyTransport,
        },
      });
      terminalRef.current = terminal;

      const pane = terminal.getActivePane();
      const containerResize = new ResizeObserver(() => {
        if (canControlRef.current) terminal.updateSize();
      });
      containerResize.observe(root);
      if (pane) {
        void pane.runtime.lifecycle
          .init()
          .then(() => {
            if (signal.aborted) return;
            pane.runtime.interaction.resize(initialCols, initialRows);
            terminal.connectPty('linkcode://terminal');
            if (canControlRef.current) terminal.updateSize(true);
            void onReadyRef.current();
          })
          .catch((error: unknown) => {
            if (signal.aborted) return;
            void onErrorRef.current(
              extractErrorMessage(error, false) ?? 'Unknown terminal renderer error',
            );
          });
      } else {
        void onErrorRef.current('Restty did not create a terminal pane.');
      }

      return () => {
        applyingRemoteResizeRef.current = false;
        terminalRef.current = null;
        callbacksRef.current = null;
        containerResize.disconnect();
        terminal.destroy();
      };
    },
    [initialCols, initialRows],
  );

  return (
    <>
      <style>{STYLES}</style>
      <div id="frame">
        <div id="terminal" ref={rootRef} />
      </div>
    </>
  );
}

function assertTerminalRendererEvent(
  value: DOMImperativeValue,
): asserts value is TerminalRendererEvent {
  if (
    Array.isArray(value) &&
    ((value.length === 2 && value[0] === 'w' && typeof value[1] === 'string') ||
      (value.length === 3 &&
        value[0] === 'r' &&
        typeof value[1] === 'number' &&
        typeof value[2] === 'number'))
  ) {
    return;
  }
  throw new TypeError('Invalid terminal renderer event');
}

function applyRemoteResize(
  terminal: Restty | null,
  applyingRemoteResizeRef: { current: boolean },
  cols: number,
  rows: number,
): void {
  if (!terminal) return;
  applyingRemoteResizeRef.current = true;
  try {
    terminal.resize(cols, rows);
  } finally {
    applyingRemoteResizeRef.current = false;
  }
}
