import { useSyncExternalStore } from 'react';

/** Which device drove the most recent interaction — the signal `:focus-visible` keeps to itself,
 * exposed so motion can stay off keyboard-driven changes (a chord repeats far too often to animate). */
export type InputModality = 'pointer' | 'keyboard';

let modality: InputModality | null = null;
const subscribers = new Set<() => void>();

function record(next: InputModality): void {
  if (modality === next) return;
  modality = next;
  for (const notify of subscribers) notify();
}

const onPointerDown = (): void => record('pointer');
const onKeyDown = (): void => record('keyboard');

function subscribe(onStoreChange: () => void): () => void {
  if (subscribers.size === 0) {
    // Capture: a handler that stops propagation must not hide the modality from us.
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
  }
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size === 0) {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    }
  };
}

function getSnapshot(): InputModality | null {
  return modality;
}

/** `null` until the first interaction — callers must read unknown as "not pointer" so nothing
 * animates on the first paint. */
export function useInputModality(): InputModality | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
