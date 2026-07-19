// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceSmoothText,
  createSmoothTextState,
  reconcileSmoothText,
  useSmoothText,
} from '../smooth-text-controller';

function SmoothTextProbe({ source, isStreaming }: { source: string; isStreaming: boolean }) {
  return createElement('span', null, useSmoothText(source, isStreaming));
}

describe('smooth text controller', () => {
  afterEach(() => vi.useRealTimers());

  it('renders buffered live text on ticks and settles at completion', () => {
    vi.useFakeTimers();
    const source = 'first live burst';
    const view = render(createElement(SmoothTextProbe, { source, isStreaming: true }));
    expect(view.container.textContent).toBe('');

    act(() => vi.advanceTimersByTime(32));
    expect(view.container.textContent).toBe('fi');

    const grown = `${source} grows`;
    view.rerender(createElement(SmoothTextProbe, { source: grown, isStreaming: true }));
    act(() => vi.advanceTimersByTime(32));
    expect(grown.startsWith(view.container.textContent)).toBe(true);
    expect(view.container.textContent).not.toBe(grown);

    view.rerender(createElement(SmoothTextProbe, { source: grown, isStreaming: false }));
    expect(view.container.textContent).not.toBe(grown);
    act(() => vi.advanceTimersByTime(8 * 32));
    expect(view.container.textContent).toBe(grown);
  });

  it('drains bursts exactly without splitting graphemes', () => {
    const prefix = 'Answer: ';
    const family = '👨\u{200D}👩\u{200D}👧\u{200D}👦';
    const accent = 'é';
    let state = createSmoothTextState(prefix, false);

    state = reconcileSmoothText(state, `${prefix}${family}${accent}abcdefghi`, false);
    state = advanceSmoothText(state);
    expect(state.visible).toBe(`${prefix}${family}${accent}`);

    const source = `${state.source} — complete`;
    state = reconcileSmoothText(state, source, false);
    const seen = [state.visible];
    for (let tick = 0; tick < 8; tick++) {
      state = advanceSmoothText(state);
      seen.push(state.visible);
    }

    expect(state.visible).toBe(source);
    expect(seen.every((visible) => source.startsWith(visible))).toBe(true);

    for (const [initial, nextSource, firstStep] of [
      ['👨', '👨\u{200D}👩x', '👨\u{200D}👩'],
      ['🇺', '🇺🇸x', '🇺🇸'],
      ['e', 'éx', 'é'],
    ]) {
      const joined = reconcileSmoothText(createSmoothTextState(initial, false), nextSource, false);
      expect(advanceSmoothText(joined).visible).toBe(firstStep);
    }
  });
});
