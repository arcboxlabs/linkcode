import ibmPlexMonoWoff2 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useRef } from 'react';
import { createRestty } from 'restty';
import type { PtyTransport } from 'restty/internal';
import type { TerminalSession } from './session';

// restty renders on a GPU canvas with its own text shaper and needs raw font bytes; its default
// `fontPreset: 'default-cdn'` fetches from cdn.jsdelivr.net, which the renderer CSP blocks. Bundle
// IBM Plex Mono inline instead (no network, no CDN).
const MONO_FONT = decodeDataUri(ibmPlexMonoWoff2);

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

      const restty = createRestty({
        root: container,
        appOptions: {
          autoResize: true,
          fontPreset: 'none',
          fontSources: [
            { type: 'buffer', data: MONO_FONT, label: 'IBM Plex Mono' },
            // Fall back to the user's installed fonts for glyphs IBM Plex Mono lacks — Nerd/powerline
            // icons, CJK, emoji — via the Local Font Access API (Electron allows queryLocalFonts with
            // no prompt). Each source resolves the first family whose name contains a matcher
            // (case-insensitive); unmatched families are skipped, so the list is safe.
            { type: 'local', matchers: ['nerd font', 'powerline'], label: 'symbols' },
            {
              type: 'local',
              matchers: [
                'pingfang',
                'hiragino sans',
                'microsoft yahei',
                'noto sans cjk',
                'source han sans',
              ],
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
          ],
          ptyTransport: createSessionPtyTransport(session),
          // Connect once the renderer core is ready, so the shell's initial prompt (replayed from the
          // client prebuffer on subscribe) isn't dropped before the WASM terminal can render it.
          callbacks: {
            onBackend() {
              if (!signal.aborted) restty.connectPty('session://terminal');
            },
          },
        },
      });

      return () => {
        restty.destroy();
      };
    },
    [session],
  );

  return <div ref={containerRef} className={className} />;
}
