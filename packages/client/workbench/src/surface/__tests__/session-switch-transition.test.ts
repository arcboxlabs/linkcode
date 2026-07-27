// @vitest-environment jsdom

import type { SessionId } from '@linkcode/schema';
import { wait } from 'foxts/wait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySessionSwitchTransition } from '../session-switch-transition';

// The real store transitively imports the whole @linkcode/ui barrel (dnd-kit needs
// ResizeObserver); the transition only reads `reduceMotion`, so stub exactly that.
const prefs = vi.hoisted(() => ({ reduceMotion: false }));
vi.mock('../../settings/appearance-store', () => ({
  useAppearancePrefsStore: { getState: () => prefs },
}));

const SESSION = 'session-1' as SessionId;

function installVt(impl: (update: () => void) => { finished: Promise<void> }): void {
  document.startViewTransition = impl as unknown as typeof document.startViewTransition;
}

function mountPair(): { row: HTMLElement; header: HTMLElement } {
  const row = document.createElement('span');
  row.dataset.threadTitle = SESSION;
  const header = document.createElement('div');
  header.dataset.conversationTitle = '';
  document.body.append(row, header);
  return { row, header };
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'startViewTransition');
  prefs.reduceMotion = false;
});

describe('applySessionSwitchTransition', () => {
  it('applies plainly when the API is missing', () => {
    mountPair();
    const apply = vi.fn();
    applySessionSwitchTransition(SESSION, apply);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('applies plainly under reduce-motion even with the API present', () => {
    mountPair();
    const startViewTransition = vi.fn();
    installVt(startViewTransition);
    prefs.reduceMotion = true;
    const apply = vi.fn();
    applySessionSwitchTransition(SESSION, apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('applies plainly when the clicked row is not in the DOM', () => {
    const startViewTransition = vi.fn();
    installVt(startViewTransition);
    const apply = vi.fn();
    applySessionSwitchTransition(SESSION, apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('pairs the row and header names around the switch, then clears them', async () => {
    const { row, header } = mountPair();
    let rowNameDuringCapture = '';
    let headerNameAfterUpdate = '';
    installVt((update) => {
      rowNameDuringCapture = row.style.getPropertyValue('view-transition-name');
      update();
      headerNameAfterUpdate = header.style.getPropertyValue('view-transition-name');
      return { finished: Promise.resolve() };
    });
    const apply = vi.fn();
    applySessionSwitchTransition(SESSION, apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(rowNameDuringCapture).toBe('thread-title');
    expect(headerNameAfterUpdate).toBe('thread-title');
    expect(row.style.getPropertyValue('view-transition-name')).toBe('');
    // The cleanup sits behind finished → catch → finally; a macrotask flushes all of them.
    await wait(0);
    expect(header.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('clears a stale header name even when the transition is interrupted', async () => {
    const { header } = mountPair();
    installVt((update) => {
      update();
      return { finished: Promise.reject(new Error('skipped')) };
    });
    applySessionSwitchTransition(SESSION, vi.fn());
    await wait(0);
    expect(header.style.getPropertyValue('view-transition-name')).toBe('');
  });
});
