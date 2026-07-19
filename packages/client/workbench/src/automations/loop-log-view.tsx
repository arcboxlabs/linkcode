import type { LoopLogEntry, LoopLogLevel, LoopLogSource } from '@linkcode/schema';
import { useIsomorphicLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useRef } from 'react';

const LEVEL_CLASS: Record<LoopLogLevel, string> = {
  info: 'text-foreground/80',
  warn: 'text-amber-500',
  error: 'text-destructive',
};

const SOURCE_LABEL: Record<LoopLogSource, string> = {
  system: 'sys',
  worker: 'wrk',
  verifier: 'vfy',
  check: 'chk',
};

/** Near-bottom threshold (px) within which the view keeps following new lines. */
const STICK_THRESHOLD_PX = 24;

/**
 * Read-only monospace renderer for a loop's live log. Follows the tail while the user is at the
 * bottom, and pauses following the moment they scroll up. Pure presentation over a plain
 * `LoopLogEntry[]` — no WASM, no data plane.
 */
export function LoopLogView({
  entries,
  emptyLabel,
}: {
  entries: readonly LoopLogEntry[];
  emptyLabel: string;
}): React.ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-muted-foreground text-xs">
        {emptyLabel}
      </div>
    );
  }

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs leading-relaxed"
    >
      {entries.map((entry) => (
        <div key={entry.seq} className="flex gap-2 whitespace-pre-wrap break-words">
          <span className="shrink-0 text-muted-foreground">{SOURCE_LABEL[entry.source]}</span>
          <span className={`min-w-0 flex-1 ${LEVEL_CLASS[entry.level]}`}>{entry.message}</span>
        </div>
      ))}
    </div>
  );
}
