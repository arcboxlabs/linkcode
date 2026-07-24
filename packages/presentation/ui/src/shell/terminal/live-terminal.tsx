import { useEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { falseFn, noop } from 'foxts/noop';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { PtyTransport } from 'restty';
import { Restty } from 'restty';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { resolveTerminalFonts } from './fonts';
import type { TerminalColorScheme } from './prefs';
import {
  DEFAULT_TERMINAL_COLOR_SCHEME,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
} from './prefs';
import type { TerminalSession } from './session';
import { applyTerminalTheme } from './terminal-theme';

// Terminal tabs stay mounted (visibility-toggled) while N tabs are open, so share one
// MutationObserver for the `.dark` class flip across all instances instead of one per terminal.
const themeChangeListeners = new Set<() => void>();
let themeChangeObserver: MutationObserver | null = null;
const ignoreTerminalResize: (cols: number, rows: number) => void = noop;

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function subscribeThemeChange(listener: () => void): () => void {
  themeChangeListeners.add(listener);
  if (!themeChangeObserver) {
    themeChangeObserver = new MutationObserver(() => {
      for (const fn of themeChangeListeners) fn();
    });
    themeChangeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  return () => {
    themeChangeListeners.delete(listener);
    if (themeChangeListeners.size === 0) {
      themeChangeObserver?.disconnect();
      themeChangeObserver = null;
    }
  };
}

function createThemeChangeHandler(
  resttyRef: React.RefObject<Restty | null>,
  frameRef: React.RefObject<HTMLDivElement | null>,
  colorScheme: TerminalColorScheme,
): () => void {
  return () => {
    if (resttyRef.current) applyTerminalTheme(resttyRef.current, frameRef.current, colorScheme);
  };
}

/** Bridge a {@link TerminalSession} to restty's native PTY transport. Load-bearing: with a
 * connected transport restty does NOT locally echo keystrokes; the transportless xterm-shim path
 * echoes on top of the shell's own echo — every character twice and broken backspace. */
export function createSessionPtyTransport(
  session: TerminalSession,
  applyHostResize: (cols: number, rows: number) => void,
): PtyTransport {
  let unsubscribe: (() => void) | null = null;
  let connected = false;
  let applyingHostResize = false;
  const close = (): void => {
    connected = false;
    unsubscribe?.();
    unsubscribe = null;
  };
  return {
    connect({ callbacks }) {
      close();
      const subscriptionState = { exited: false };
      const nextUnsubscribe = session.subscribe(
        (event) => {
          if (event.type === 'write') {
            callbacks.onData?.(event.data);
            return;
          }
          applyingHostResize = true;
          try {
            applyHostResize(event.cols, event.rows);
          } finally {
            applyingHostResize = false;
          }
        },
        (code) => {
          subscriptionState.exited = true;
          connected = false;
          callbacks.onExit?.(code ?? 0);
        },
      );
      if (subscriptionState.exited) {
        nextUnsubscribe();
        return;
      }
      unsubscribe = nextUnsubscribe;
      connected = true;
      callbacks.onConnect?.();
    },
    disconnect: close,
    destroy: close,
    sendInput(data) {
      if (session.canControl()) session.sendInput(data);
      return true;
    },
    resize(cols, rows) {
      if (!applyingHostResize && session.canControl()) session.resize(cols, rows);
      return true;
    },
    isConnected: () => connected,
  };
}

/**
 * Interactive restty terminal fed from a {@link TerminalSession}; presentation-only. `session`
 * must be stable per terminal (memoize it) or the effect tears the terminal down every render.
 * `suspended` freezes the box at its current pixel size while a host panel animates, so restty's
 * ResizeObserver never sees transient sizes — each PTY resize would stack a blank prompt line.
 */
export function LiveTerminal({
  session,
  suspended = false,
  className,
  fontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
  fontSize = DEFAULT_TERMINAL_FONT_SIZE,
  colorScheme = DEFAULT_TERMINAL_COLOR_SCHEME,
}: {
  session: TerminalSession;
  suspended?: boolean;
  className?: string;
  fontFamily?: string;
  fontSize?: number;
  colorScheme?: TerminalColorScheme;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const subscribeReplayTruncated = useCallback(
    (onStoreChange: () => void) => session.subscribeReplayTruncated(onStoreChange),
    [session],
  );
  const replayTruncated = useSyncExternalStore(
    subscribeReplayTruncated,
    () => session.replayWasTruncated(),
    falseFn,
  );
  const resttyRef = useRef<Restty | null>(null);

  // Layout effect so the freeze lands before the panel's first shrink frame paints. Freeze only
  // when the content box has real extent: a collapsed mount measures 0 (the frame still reports
  // its padding), and pinning that would trap restty at birth size.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const container = containerRef.current;
    if (!frame || !container) return;
    if (suspended) {
      const content = container.getBoundingClientRect();
      if (content.width === 0 || content.height === 0) return;
      const rect = frame.getBoundingClientRect();
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
    } else {
      frame.style.removeProperty('width');
      frame.style.removeProperty('height');
    }
  }, [suspended]);

  useEffect(
    (signal) => {
      const frame = frameRef.current;
      const container = containerRef.current;
      if (!frame || !container) return;

      let revealFrame = 0;
      let destroyTerminal = noop;
      let unsubscribeController = noop;
      let disconnectContainerResize = noop;
      const hostResize = { apply: ignoreTerminalResize };
      void (async () => {
        // Font resolution is async (Local Font Access probe) but cached module-wide, so only the
        // first terminal of a renderer session pays for it.
        const fonts = await resolveTerminalFonts(fontFamily);
        if (signal.aborted) return;
        const restty = new Restty({
          root: container,
          // Init manually: connectPty must land only once the renderer core is ready, or the
          // replayed initial prompt is dropped before the WASM terminal can render it. shortcuts
          // off: restty's unscoped Cmd/Ctrl+D pane splitter would fire per mounted terminal.
          surface: { autoInit: false, shortcuts: false },
          // fontSizeMode 'em' makes fontSize the glyph em size (like every other terminal);
          // restty's default 'height' mode reads it as full line height — ~30% smaller glyphs.
          terminal: {
            autoResize: false,
            fonts,
            fontSize,
            fontSizeMode: 'em',
            forwardTerminalReplies: false,
          },
          services: {
            beforeInput: () => (session.canControl() ? undefined : null),
            ptyTransport: createSessionPtyTransport(session, (cols, rows) =>
              hostResize.apply(cols, rows),
            ),
          },
        });
        destroyTerminal = () => restty.destroy();
        const pane = restty.getActivePane();
        if (!pane) return;
        await pane.runtime.lifecycle.init();
        if (isAborted(signal)) return;
        const initialSize = session.initialSize();
        if (initialSize) {
          pane.runtime.interaction.resize(initialSize.cols, initialSize.rows);
        }
        hostResize.apply = (cols, rows) => pane.runtime.interaction.resize(cols, rows);
        resttyRef.current = restty;
        applyTerminalTheme(restty, frame, colorScheme);
        restty.connectPty('session://terminal');
        const containerResize = new ResizeObserver(() => {
          if (session.canControl()) restty.updateSize();
        });
        containerResize.observe(container);
        disconnectContainerResize = () => containerResize.disconnect();
        unsubscribeController = session.subscribeController((canControl) => {
          if (canControl) restty.updateSize(true);
        });
        if (session.canControl()) restty.updateSize(true);
        // Reveal only once a themed frame can be painted, so the default black frames restty
        // draws while the WASM core boots are never shown.
        revealFrame = requestAnimationFrame(() => {
          frame.style.opacity = '1';
        });
      })();

      return () => {
        cancelAnimationFrame(revealFrame);
        disconnectContainerResize();
        unsubscribeController();
        resttyRef.current = null;
        destroyTerminal();
      };
    },
    // fontFamily/fontSize/colorScheme only seed the initial config (live-synced by the effects
    // below); as deps they would tear the terminal down and rebuild it on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- intentional: initial seed only
    [session],
  );

  // Live-apply appearance prefs without tearing the terminal down; on first mount resttyRef is
  // still null and they no-op — the constructor config already applied the initial values.
  useEffect(() => {
    resttyRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  useEffect(
    (signal) => {
      const restty = resttyRef.current;
      if (!restty) return;
      void resolveTerminalFonts(fontFamily).then((fonts) => {
        if (!signal.aborted && resttyRef.current === restty) void restty.setFonts(fonts);
      });
    },
    [fontFamily],
  );

  useEffect(() => {
    const apply = createThemeChangeHandler(resttyRef, frameRef, colorScheme);
    apply();
    // Re-apply on `.dark` flips too, so the 'auto' scheme keeps following the app mode.
    return subscribeThemeChange(apply);
  }, [colorScheme]);

  // Padding lives on the frame, never on the restty root: restty sizes its canvas from the root's
  // clientWidth/clientHeight, which include padding, so a padded root would overflow into the inset.
  return (
    <div
      ref={frameRef}
      data-keyboard-shortcut-local=""
      className={cn('relative p-2 opacity-0 transition-opacity duration-150', className)}
    >
      <div ref={containerRef} className="size-full" />
      {replayTruncated && (
        <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-border bg-background/95 px-2 py-1 text-muted-foreground text-xs shadow-sm">
          {t('terminalReplayTruncated')}
        </div>
      )}
    </div>
  );
}
