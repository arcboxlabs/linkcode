// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown } from '../markdown';

afterEach(cleanup);

const FENCE = '```ts\nconst greeting: string = "hello";\n```';

it('keeps fragment links in the document and opens external links in a new tab', () => {
  const { getByRole } = render(
    <Markdown>
      {'## Target\n\n[Jump to target](#target)\n\n[External](https://example.com)'}
    </Markdown>,
  );

  const heading = getByRole('heading', { name: 'Target' });
  const fragmentLink = getByRole('link', { name: 'Jump to target' });
  const externalLink = getByRole('link', { name: 'External' });

  expect(heading.getAttribute('id')).toBe('user-content-target');
  expect(fragmentLink.getAttribute('href')).toBe('#user-content-target');
  expect(fragmentLink.getAttribute('target')).toBeNull();
  expect(fragmentLink.getAttribute('rel')).toBeNull();
  expect(externalLink.getAttribute('target')).toBe('_blank');
  expect(externalLink.getAttribute('rel')).toBe('noreferrer');

  const scrollIntoView = vi.fn();
  heading.scrollIntoView = scrollIntoView;
  fireEvent.click(fragmentLink);
  expect(scrollIntoView).toHaveBeenCalledOnce();
});

// Pins the @streamdown/code ↔ shiki contract: the workspace override forces shiki 4 under the
// plugin (which pins ^3) to keep a single copy in the renderer bundle (CODE-215). If the plugin's
// createHighlighter/bundledLanguages usage ever breaks against the resolved shiki major, the
// fence renders as plain text and this fails.
it('highlights a fenced code block through the shiki pipeline', async () => {
  const { container } = render(<Markdown>{FENCE}</Markdown>);
  // The plugin emits per-token spans carrying the theme color as the --sdm-c custom property.
  await waitFor(
    () => {
      const tokens = container.querySelectorAll('code span[style*="--sdm-c"]');
      expect(tokens.length).toBeGreaterThan(2);
    },
    { timeout: 10000 },
  );
}, 15000);
