import { useEffect, useRef } from 'react';
import { Terminal } from 'restty/xterm';
import type { TerminalSession } from './session';

/**
 * Interactive terminal rendered by restty's xterm-compat shim, fed from a {@link TerminalSession}.
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({ cols: 80, rows: 24, appOptions: { autoResize: true } });
    term.open(container);
    const onData = term.onData((data) => session.sendInput(data));
    const onResize = term.onResize(({ cols, rows }) => session.resize(cols, rows));
    const unsubscribe = session.subscribe((data) => term.write(data));

    return () => {
      unsubscribe();
      onData.dispose();
      onResize.dispose();
      term.dispose();
    };
  }, [session]);

  return <div ref={containerRef} className={className} />;
}
