import { useSyncExternalStore } from 'react';
import { relativeTimeLabel } from './relative-time';

const TICK_MS = 60000;

/** Shared clock: one `setInterval` per minute while any component is subscribed. Never read
 * `Date.now()` in `getSnapshot` — the compiler-memoized render must see only this stored value;
 * the interval callback and subscribe-time arming are the only writers. */
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
    if (timer !== null && listeners.size === 0) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** `relativeTimeLabel(timestamp, …)` that re-renders once a minute so the label stays live. */
export function useRelativeTimeLabel(timestamp: number, locale?: string): string {
  const liveNow = useSyncExternalStore(subscribe, getSnapshot);
  return relativeTimeLabel(timestamp, liveNow, locale);
}
