import type { SessionId } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { flushSync } from 'react-dom';
import { useAppearancePrefsStore } from '../settings/appearance-store';

/** The matched-geometry pair for a session switch: the clicked thread row's title
 * (`data-thread-title`) travels to the conversation header title (`data-conversation-title`).
 *
 * TODO(react-view-transition): the imperative naming/generation dance below is the stable-React
 * substitute for React's experimental `<ViewTransition>` component (absent from react 19.2 —
 * verified against the installed build). When it reaches stable, replace this module with two
 * `<ViewTransition name>` wrappers. Router-driven alternatives don't apply: desktop is
 * deliberately router-free and webview's threads are not routes. */
const PAIR_NAME = 'thread-title';

/** Monotonic switch generation: a call supersedes every earlier one, whose queued update
 * callback then becomes a no-op (last-wins — no stale apply, record, or pair naming). */
let generation = 0;
let pendingSource: HTMLElement | null = null;

function headerTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-title]');
}

/**
 * Wrap a session switch in a View Transition. Falls back to a plain apply without the API,
 * under reduce-motion, or when the clicked row is not in the DOM. Only the current switch's
 * pair may carry the transition name — a duplicate name in either snapshot makes the browser
 * skip the whole transition — so entering a switch strips the superseded pair's names, and a
 * superseded callback applies nothing (its `apply`, and any history record inside it, is owned
 * by the newest call).
 */
export function applySessionSwitchTransition(id: SessionId, apply: () => void): void {
  const gen = ++generation;
  pendingSource?.style.removeProperty('view-transition-name');
  pendingSource = null;
  headerTitle()?.style.removeProperty('view-transition-name');

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
  pendingSource = source;
  source.style.setProperty('view-transition-name', PAIR_NAME);
  const transition = document.startViewTransition(() => {
    if (gen !== generation) return;
    pendingSource = null;
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- the browser captures the new snapshot when this callback returns, so the React commit must land synchronously
    flushSync(apply);
    source.style.removeProperty('view-transition-name');
    headerTitle()?.style.setProperty('view-transition-name', PAIR_NAME);
  });
  // `finished` rejects when the transition is interrupted; clean up only if still current, or a
  // stale finish would strip the name the newer switch just paired.
  transition.finished.catch(noop).finally(() => {
    if (gen === generation) headerTitle()?.style.removeProperty('view-transition-name');
  });
}
