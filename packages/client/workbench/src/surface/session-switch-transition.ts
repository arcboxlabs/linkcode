import type { SessionId } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { flushSync } from 'react-dom';
import { useAppearancePrefsStore } from '../settings/appearance-store';

/** The matched-geometry pair for a session switch: the clicked thread row's title
 * (`data-thread-title`) travels to the conversation header title (`data-conversation-title`). */
const PAIR_NAME = 'thread-title';

function headerTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-title]');
}

/**
 * Wrap a session switch in a View Transition. Falls back to a plain apply without the API,
 * under reduce-motion, or when the clicked row is not in the DOM. Only the switching pair may
 * carry the transition name: a duplicate name in either snapshot makes the browser skip the
 * whole transition, so the header's name is cleared on entry and after every run.
 */
export function applySessionSwitchTransition(id: SessionId, apply: () => void): void {
  // Session ids are daemon-generated identifiers (no quotes/backslashes) — safe to interpolate.
  const source = document.querySelector<HTMLElement>(`[data-thread-title="${id}"]`);
  if (
    !source ||
    typeof document.startViewTransition !== 'function' ||
    useAppearancePrefsStore.getState().reduceMotion
  ) {
    apply();
    return;
  }
  headerTitle()?.style.removeProperty('view-transition-name');
  source.style.setProperty('view-transition-name', PAIR_NAME);
  const transition = document.startViewTransition(() => {
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- the browser captures the new snapshot when this callback returns, so the React commit must land synchronously
    flushSync(apply);
    source.style.removeProperty('view-transition-name');
    headerTitle()?.style.setProperty('view-transition-name', PAIR_NAME);
  });
  // `finished` rejects when a newer transition interrupts this one; cleanup runs either way.
  transition.finished
    .catch(noop)
    .finally(() => headerTitle()?.style.removeProperty('view-transition-name'));
}
