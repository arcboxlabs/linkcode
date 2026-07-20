import { useSyncExternalStore } from 'react';

const TICK_MS = 1000;

/** Shared 1s clock: one `setInterval` while any live counter is subscribed (mirrors
 * `shell/use-relative-time-label.ts`). Never read `Date.now()` in `getSnapshot` — the
 * compiler-memoized render must see only this stored value. */
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** Live wall-clock (ms) that re-renders once a second while subscribed. Only mount this in a
 * component that is present exclusively while the counter is live, so the interval runs then. */
export function useNowEverySecond(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Compact elapsed label mirroring codex's `fmt_elapsed_compact`: `0s`, `59s`, `1m 00s`, `1h 00m 00s`. */
export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (secs < 3600) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(mm).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
