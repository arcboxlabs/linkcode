// @vitest-environment jsdom

import type { SessionId } from '@linkcode/schema';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadTitle } from '../shell-control';

const ENTER_CLASS = 'thread-title-enter';

function renderTitle(sessionId: string, title: string) {
  return render(
    <ThreadTitle data-testid="title" sessionId={sessionId as SessionId}>
      {title}
    </ThreadTitle>,
  );
}

function titleOf(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="title"]');
  if (!(element instanceof HTMLElement)) throw new Error('title not rendered');
  return element;
}

afterEach(cleanup);

describe('ThreadTitle', () => {
  it('remounts the element on a switch so the entrance can replay', () => {
    const { container, rerender } = renderTitle('a', 'first');
    fireEvent.pointerDown(document);
    const first = titleOf(container);

    rerender(
      <ThreadTitle data-testid="title" sessionId={'b' as SessionId}>
        second
      </ThreadTitle>,
    );

    expect(titleOf(container)).not.toBe(first);
    expect(titleOf(container).textContent).toBe('second');
  });

  it('animates a pointer-driven switch', () => {
    const { container } = renderTitle('a', 'first');
    fireEvent.pointerDown(document);

    expect(titleOf(container).classList.contains(ENTER_CLASS)).toBe(true);
  });

  it('stays static for a keyboard-driven switch — a history chord repeats too often to animate', () => {
    const { container } = renderTitle('a', 'first');
    fireEvent.pointerDown(document);
    fireEvent.keyDown(document, { key: '[', metaKey: true });

    expect(titleOf(container).classList.contains(ENTER_CLASS)).toBe(false);
  });

  it('re-arms on the next pointer interaction', () => {
    const { container } = renderTitle('a', 'first');
    fireEvent.keyDown(document, { key: '[', metaKey: true });
    expect(titleOf(container).classList.contains(ENTER_CLASS)).toBe(false);

    fireEvent.pointerDown(document);
    expect(titleOf(container).classList.contains(ENTER_CLASS)).toBe(true);
  });
});
