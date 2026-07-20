// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown } from '../markdown';

afterEach(cleanup);

const FENCE = '```ts\nconst greeting: string = "hello";\n```';

it('scopes heading anchors to their Markdown document and keeps external links separate', () => {
  const { getAllByRole, getByRole } = render(
    <>
      <Markdown headingAnchors>{'## Target\n\n[First jump](#target)'}</Markdown>
      <Markdown headingAnchors>
        {'## Target\n\n[Second jump](#target)\n\n[External](https://example.com)'}
      </Markdown>
    </>,
  );

  const headings = getAllByRole('heading', { name: 'Target' });
  const firstFragmentLink = getByRole('link', { name: 'First jump' });
  const secondFragmentLink = getByRole('link', { name: 'Second jump' });
  const externalLink = getByRole('link', { name: 'External' });

  expect(headings[0]?.id).not.toBe(headings[1]?.id);
  expect(firstFragmentLink.getAttribute('href')).toBe(`#${headings[0]?.id}`);
  expect(secondFragmentLink.getAttribute('href')).toBe(`#${headings[1]?.id}`);
  expect(secondFragmentLink.getAttribute('target')).toBeNull();
  expect(secondFragmentLink.getAttribute('rel')).toBeNull();
  expect(externalLink.getAttribute('target')).toBe('_blank');
  expect(externalLink.getAttribute('rel')).toBe('noreferrer');

  const scrollIntoView = vi.fn();
  if (headings[1]) headings[1].scrollIntoView = scrollIntoView;
  fireEvent.click(secondFragmentLink);
  expect(scrollIntoView).toHaveBeenCalledOnce();
});

it('generates scoped anchors for raw HTML headings after parsing them', () => {
  const { getByRole } = render(
    <Markdown headingAnchors>{'<h2>HTML Target</h2>\n\n[Jump](#html-target)'}</Markdown>,
  );

  const heading = getByRole('heading', { name: 'HTML Target' });
  expect(heading.id).not.toBe('');
  expect(getByRole('link', { name: 'Jump' }).getAttribute('href')).toBe(`#${heading.id}`);
});

it('deduplicates repeated headings across one anchored document', () => {
  const { getAllByRole, getByRole } = render(
    <Markdown headingAnchors>{'## Repeat\n\n## Repeat\n\n[Jump](#repeat-1)'}</Markdown>,
  );

  const headings = getAllByRole('heading', { name: 'Repeat' });
  expect(headings[0]?.id).not.toBe(headings[1]?.id);
  expect(getByRole('link', { name: 'Jump' }).getAttribute('href')).toBe(`#${headings[1]?.id}`);
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
