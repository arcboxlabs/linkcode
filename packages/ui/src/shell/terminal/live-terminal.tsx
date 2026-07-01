import ibmPlexMonoWoff2 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useRef } from 'react';
import { createRestty } from 'restty';
import type { PtyTransport } from 'restty/internal';
import { cn } from '../../lib/cn';
import type { TerminalSession } from './session';
import { applyTerminalTheme } from './terminal-theme';

// restty renders on a GPU canvas with its own text shaper and needs raw font bytes; its default
// `fontPreset: 'default-cdn'` fetches from cdn.jsdelivr.net, which the renderer CSP blocks. Bundle
// IBM Plex Mono inline instead (no network, no CDN).
const MONO_FONT = decodeDataUri(ibmPlexMonoWoff2);
const TERMINAL_FONT_SOURCES: NonNullable<Parameters<typeof createRestty>[0]['fontSources']> = [
  { type: 'buffer', data: MONO_FONT, label: 'IBM Plex Mono' },
  // Fall back to the user's installed fonts for glyphs IBM Plex Mono lacks — Nerd/powerline
  // icons, CJK, emoji — via the Local Font Access API when the host allows it. Match both full
  // Nerd Font names and common abbreviated NF family names such as MesloLGS NF / CaskaydiaCove NF.
  {
    type: 'local',
    matchers: [
      'symbols nerd font',
      'symbols nerd font mono',
      'jetbrainsmono nerd font',
      'jetbrains mono nerd font',
      'fira code nerd font',
      'hack nerd font',
      'meslo lgm nerd font',
      'meslo lgs nf',
      'meslolgs nf',
      'caskaydia',
      'cascadia code nf',
      'monaspace nerd font',
      'nerd font mono',
      'nerd font',
      'powerline',
    ],
    label: 'symbols',
  },
  {
    type: 'local',
    matchers: ['pingfang', 'hiragino sans', 'microsoft yahei', 'noto sans cjk', 'source han sans'],
    label: 'cjk',
  },
  {
    type: 'local',
    matchers: ['apple color emoji', 'segoe ui emoji', 'noto color emoji'],
    label: 'emoji',
  },
  {
    type: 'local',
    matchers: ['sf mono', 'menlo', 'monaco', 'consolas', 'dejavu sans mono'],
    label: 'mono',
  },
];

function decodeDataUri(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(',') + 1));
  return Uint8Array.from(binary, (ch) => ch.codePointAt(0) ?? 0).buffer;
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
 */
export function LiveTerminal({
  session,
  className,
}: {
  session: TerminalSession;
  className?: string;
}): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  useAbortableEffect(
    (signal) => {
      const container = containerRef.current;
      if (!container) return;

      let revealFrame = 0;
      const restty = createRestty({
        root: container,
        fontSources: TERMINAL_FONT_SOURCES,
        appOptions: {
          autoResize: true,
          fontPreset: 'none',
          ptyTransport: createSessionPtyTransport(session),
          // Connect once the renderer core is ready, so the shell's initial prompt (replayed from the
          // client prebuffer on subscribe) isn't dropped before the WASM terminal can render it.
          callbacks: {
            onBackend() {
              if (signal.aborted) return;
              applyTerminalTheme(restty);
              restty.connectPty('session://terminal');
              // Reveal only once a themed frame can be painted, so the default black frames restty
              // draws while the WASM core boots are never shown.
              revealFrame = requestAnimationFrame(() => {
                container.style.opacity = '1';
              });
            },
          },
        },
      });

      // The terminal theme follows the app's `.dark` class, so re-apply whenever it flips
      // (light/dark mode change) — no need to tear down the terminal.
      const modeObserver = new MutationObserver(() => applyTerminalTheme(restty));
      modeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      return () => {
        cancelAnimationFrame(revealFrame);
        modeObserver.disconnect();
        restty.destroy();
      };
    },
    [session],
  );

  return (
    <div
      ref={containerRef}
      className={cn('opacity-0 transition-opacity duration-150', className)}
    />
  );
}
