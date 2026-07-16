import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useRef } from 'react';
import type { PtyTransport } from 'restty';
import { Restty } from 'restty';
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

// Every mounted LiveTerminal needs to re-theme on the same `.dark` class flip, but terminal tabs
// stay mounted (visibility-toggled, not unmounted) while N tabs are open — so share a single
// MutationObserver across all instances instead of one per terminal.
const themeChangeListeners = new Set<() => void>();
let themeChangeObserver: MutationObserver | null = null;

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

/**
 * Bridge a {@link TerminalSession} to restty's native PTY transport. This is load-bearing: with a
 * connected transport, restty sends keystrokes straight out through its key encoder and does NOT
 * echo them into its own core. The xterm-shim `write`/`onData` path has no transport, so restty
 * locally echoes every keystroke — which, on top of the shell's own echo, shows each character
 * twice and breaks backspace.
 */
function createSessionPtyTransport(session: TerminalSession): PtyTransport {
  let unsubscribe: (() => void) | null = null;
  let connected = false;
  const close = (): void => {
    connected = false;
    unsubscribe?.();
    unsubscribe = null;
  };
  return {
    connect({ callbacks }) {
      close();
      unsubscribe = session.subscribe(
        (data) => callbacks.onData?.(data),
        (code) => callbacks.onExit?.(code ?? 0),
      );
      connected = true;
      callbacks.onConnect?.();
    },
    disconnect: close,
    destroy: close,
    sendInput(data) {
      session.sendInput(data);
      return true;
    },
    resize(cols, rows) {
      session.resize(cols, rows);
      return true;
    },
    isConnected: () => connected,
  };
}

/**
 * Interactive terminal rendered by restty (native API), fed from a {@link TerminalSession}.
 * Presentation-only: it owns no connection logic. `session` must be stable per terminal (memoize it)
 * or the effect will tear the terminal down and re-create it on every render.
 *
 * `suspended` freezes the terminal's box at its current pixel size (an ancestor with
 * `overflow-hidden` clips it). Set it while a host panel animates shut/open: restty's
 * ResizeObserver never sees the transient sizes, so no PTY resizes reach the shell — each one
 * would make it redraw the prompt, stacking a blank prompt line per toggle.
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
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resttyRef = useRef<Restty | null>(null);

  // Layout effect so the freeze lands before the panel's first shrink frame paints. Freeze only
  // when the terminal's content box has real extent: a collapsed mount (panel never opened yet)
  // measures 0 there — pinning that would trap restty at birth size — while the frame itself
  // still reports its padding, so the content box is the reliable signal.
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

  useAbortableEffect(
    (signal) => {
      const frame = frameRef.current;
      const container = containerRef.current;
      if (!frame || !container) return;

      let revealFrame = 0;
      let restty: Restty | null = null;
      void (async () => {
        // Font resolution is async (Local Font Access probe) but cached module-wide, so only the
        // first terminal of a renderer session pays for it.
        const fonts = await resolveTerminalFonts(fontFamily);
        if (signal.aborted) return;
        restty = new Restty({
          root: container,
          // Init manually: connectPty must land only once the renderer core is ready, so the
          // shell's initial prompt (replayed from the client prebuffer on subscribe) isn't
          // dropped before the WASM terminal can render it.
          // LinkCode owns terminal tabs/panels. Restty's unscoped Cmd/Ctrl+D pane splitter would
          // otherwise fire once per mounted terminal, including hidden tabs.
          surface: { autoInit: false, shortcuts: false },
          terminal: { autoResize: true, fonts, fontSize },
          services: { ptyTransport: createSessionPtyTransport(session) },
        });
        const pane = restty.getActivePane();
        if (!pane) return;
        await pane.runtime.lifecycle.init();
        if (signal.aborted) return;
        resttyRef.current = restty;
        applyTerminalTheme(restty, frame, colorScheme);
        restty.connectPty('session://terminal');
        // Reveal only once a themed frame can be painted, so the default black frames restty
        // draws while the WASM core boots are never shown.
        revealFrame = requestAnimationFrame(() => {
          frame.style.opacity = '1';
        });
      })();

      return () => {
        cancelAnimationFrame(revealFrame);
        resttyRef.current = null;
        restty?.destroy();
      };
    },
    // fontFamily/fontSize/colorScheme seed the initial restty config, then are live-synced by the
    // effects below; adding them here would tear the terminal down and rebuild it on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: initial seed only
    [session],
  );

  // Live-apply appearance prefs without tearing the terminal down. Each runs after the async
  // construct populates resttyRef; on first mount resttyRef is still null and they no-op — the
  // constructor config above having already applied the initial values.
  useAbortableEffect(() => {
    resttyRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  useAbortableEffect(
    (signal) => {
      const restty = resttyRef.current;
      if (!restty) return;
      void resolveTerminalFonts(fontFamily).then((fonts) => {
        if (!signal.aborted && resttyRef.current === restty) void restty.setFonts(fonts);
      });
    },
    [fontFamily],
  );

  useAbortableEffect(() => {
    const apply = (): void => {
      if (resttyRef.current) applyTerminalTheme(resttyRef.current, frameRef.current, colorScheme);
    };
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
      className={cn('p-2 opacity-0 transition-opacity duration-150', className)}
    >
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
