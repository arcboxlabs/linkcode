// @vitest-environment jsdom

import type { HighlightResult } from '@streamdown/code';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RenderPrefsProvider } from '../../render-prefs';
import { HighlightedCode } from '../highlighted-code';

const mocks = vi.hoisted(() => ({
  callbacks: new Map<string, (result: HighlightResult) => void>(),
}));

vi.mock('@streamdown/code', () => ({
  createCodePlugin: () => ({
    getSupportedLanguages: () => ['html', 'json'],
    getThemes: () => ['github-light', 'github-dark'],
    highlight({ code }: { code: string }, callback?: (result: HighlightResult) => void): null {
      if (callback) mocks.callbacks.set(code, callback);
      return null;
    },
    name: 'shiki',
    supportsLanguage: () => true,
    type: 'code-highlighter',
  }),
}));

afterEach(() => {
  cleanup();
  mocks.callbacks.clear();
});

function result(content: string): HighlightResult {
  return {
    tokens: [[{ content, htmlStyle: { color: '#111111', '--shiki-dark': '#eeeeee' }, offset: 0 }]],
  };
}

it('ignores a stale asynchronous highlight after the source changes', () => {
  const { container, rerender } = render(<HighlightedCode code="old" language="html" />);
  rerender(<HighlightedCode code="new" language="json" />);

  act(() => mocks.callbacks.get('old')?.(result('stale')));
  expect(container.querySelector('code')?.textContent).toBe('new');
  expect(container.querySelector('[style*="--sdm-c"]')).toBeNull();

  act(() => mocks.callbacks.get('new')?.(result('fresh')));
  expect(container.querySelector('code')?.textContent).toBe('fresh');
  expect(container.querySelector('[style*="--sdm-c"]')).not.toBeNull();
});

it('ignores a stale asynchronous highlight after the theme changes', () => {
  const code = '<main>Hello</main>';
  const { container, rerender } = render(
    <RenderPrefsProvider
      prefs={{ reduceMotion: false, codeTheme: ['github-light', 'github-dark'] }}
    >
      <HighlightedCode code={code} language="html" />
    </RenderPrefsProvider>,
  );
  const staleCallback = mocks.callbacks.get(code);

  rerender(
    <RenderPrefsProvider prefs={{ reduceMotion: false, codeTheme: ['min-light', 'min-dark'] }}>
      <HighlightedCode code={code} language="html" />
    </RenderPrefsProvider>,
  );
  const currentCallback = mocks.callbacks.get(code);

  act(() => staleCallback?.(result('stale')));
  expect(container.querySelector('code')?.textContent).toBe(code);
  expect(container.querySelector('[style*="--sdm-c"]')).toBeNull();

  act(() => currentCallback?.(result('fresh')));
  expect(container.querySelector('code')?.textContent).toBe('fresh');
  expect(container.querySelector('[style*="--sdm-c"]')).not.toBeNull();
});
