// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown } from '../markdown';

// Fences render through ArtifactFenceRenderer, which resolves failure notes via use-intl.
vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

const FENCE = '```ts\nconst greeting: string = "hello";\n```';

it('scopes heading anchors to their Markdown document and keeps external links separate', () => {
  const { getAllByRole, getByRole } = render(
    <>
      <Markdown headingAnchors>{'## Target\n\n[First jump](#target)'}</Markdown>
      <div data-markdown-scroll-container>
        <Markdown headingAnchors>
          {'## Target\n\n[Second jump](#target)\n\n[External](https://example.com)'}
        </Markdown>
      </div>
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

  const scrollContainer = secondFragmentLink.closest<HTMLElement>(
    '[data-markdown-scroll-container]',
  );
  expect(scrollContainer).not.toBeNull();
  if (!scrollContainer || !headings[1]) return;

  Object.defineProperty(scrollContainer, 'scrollTop', { value: 120, writable: true });
  const scrollTo = vi.fn();
  scrollContainer.scrollTo = scrollTo;
  vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 100 }));
  vi.spyOn(headings[1], 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 400 }));
  const scrollIntoView = vi.fn();
  headings[1].scrollIntoView = scrollIntoView;
  fireEvent.click(secondFragmentLink);
  expect(scrollTo).toHaveBeenCalledWith({ top: 420 });
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it('generates scoped anchors for raw HTML headings after parsing them', () => {
  const { getByRole } = render(
    <Markdown headingAnchors>{'<h2>HTML Target</h2>\n\n[Jump](#html-target)'}</Markdown>,
  );

  const heading = getByRole('heading', { name: 'HTML Target' });
  expect(heading.id).not.toBe('');
  expect(getByRole('link', { name: 'Jump' }).getAttribute('href')).toBe(`#${heading.id}`);
});

it('scopes explicit heading ids from raw HTML to their Markdown document', () => {
  const { getAllByRole, getByRole } = render(
    <>
      <Markdown headingAnchors>{'<h2 id="custom">Title</h2>\n\n[First](#custom)'}</Markdown>
      <Markdown headingAnchors>{'<h2 id="custom">Title</h2>\n\n[Second](#custom)'}</Markdown>
    </>,
  );

  const headings = getAllByRole('heading', { name: 'Title' });
  expect(headings[0]?.id).not.toBe(headings[1]?.id);
  expect(getByRole('link', { name: 'First' }).getAttribute('href')).toBe(`#${headings[0]?.id}`);
  expect(getByRole('link', { name: 'Second' }).getAttribute('href')).toBe(`#${headings[1]?.id}`);
});

it('deduplicates repeated headings across one anchored document', () => {
  const { getAllByRole, getByRole } = render(
    <Markdown headingAnchors>{'## Repeat\n\n## Repeat\n\n[Jump](#repeat-1)'}</Markdown>,
  );

  const headings = getAllByRole('heading', { name: 'Repeat' });
  expect(headings[0]?.id).not.toBe(headings[1]?.id);
  expect(getByRole('link', { name: 'Jump' }).getAttribute('href')).toBe(`#${headings[1]?.id}`);
});

// Every fragment href is rewritten to its target's exact DOM id (instance scope prefix plus
// sanitize's clobber prefix), and a fragment click must never reach native navigation (the
// desktop external-browser surface).
it('keeps footnote fragment clicks in-page and scrolls between reference and definition', () => {
  const { container, getByRole } = render(
    <div data-markdown-scroll-container>
      <Markdown>{'Note.[^1]\n\n[^1]: Detail.'}</Markdown>
    </div>,
  );
  const scrollTo = vi.fn();
  (container.firstElementChild as HTMLElement).scrollTo = scrollTo;

  const reference = getByRole('link', { name: '1' });
  expect(reference.getAttribute('target')).toBeNull();
  expect(reference.getAttribute('rel')).toBeNull();

  const definition = container.querySelector<HTMLElement>('li[id$="user-content-fn-1"]');
  expect(definition).not.toBeNull();
  if (!definition) return;
  expect(reference.getAttribute('href')).toBe(`#${definition.id}`);
  vi.spyOn(definition, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 400 }));
  expect(fireEvent.click(reference)).toBe(false);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 400 });

  const backref = container.querySelector<HTMLElement>('a[data-footnote-backref]');
  const referenceAnchor = container.querySelector<HTMLElement>('[id$="user-content-fnref-1"]');
  expect(backref).not.toBeNull();
  expect(referenceAnchor).not.toBeNull();
  if (!backref || !referenceAnchor) return;
  expect(backref.getAttribute('href')).toBe(`#${referenceAnchor.id}`);
  vi.spyOn(referenceAnchor, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 150 }));
  expect(fireEvent.click(backref)).toBe(false);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 150 });
});

// The review-reported regression: two messages both defining [^1] must not share footnote ids,
// and a click must land on the clicked message's own definition, not the first in the document.
it('scopes footnote targets to their own Markdown instance', () => {
  const { container, getAllByRole } = render(
    <div data-markdown-scroll-container>
      <Markdown>{'One.[^1]\n\n[^1]: First definition.'}</Markdown>
      <Markdown>{'Two.[^1]\n\n[^1]: Second definition.'}</Markdown>
    </div>,
  );
  const scrollTo = vi.fn();
  (container.firstElementChild as HTMLElement).scrollTo = scrollTo;

  const definitions = container.querySelectorAll<HTMLElement>('li[id$="user-content-fn-1"]');
  expect(definitions).toHaveLength(2);
  expect(definitions[0]?.id).not.toBe(definitions[1]?.id);
  if (!definitions[0] || !definitions[1]) return;

  vi.spyOn(definitions[0], 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 111 }));
  vi.spyOn(definitions[1], 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 333 }));
  const references = getAllByRole('link', { name: '1' });
  expect(references).toHaveLength(2);
  if (!references[1]) return;
  expect(fireEvent.click(references[1])).toBe(false);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 333 });
});

it('resolves footnote targets in heading-anchor mode', () => {
  const { container, getByRole } = render(
    <div data-markdown-scroll-container>
      <Markdown headingAnchors>{'## Title\n\nNote.[^1]\n\n[^1]: Detail.'}</Markdown>
    </div>,
  );
  const scrollTo = vi.fn();
  (container.firstElementChild as HTMLElement).scrollTo = scrollTo;

  const reference = getByRole('link', { name: '1' });
  const definition = container.querySelector<HTMLElement>('li[id$="user-content-fn-1"]');
  expect(definition).not.toBeNull();
  expect(reference.getAttribute('href')).toBe(`#${definition?.id}`);
  expect(fireEvent.click(reference)).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it('scrolls chat heading anchors without heading-anchor mode', () => {
  const { container, getByRole } = render(
    <div data-markdown-scroll-container>
      <Markdown>{'## Target\n\n[Jump](#target)'}</Markdown>
    </div>,
  );
  const scrollTo = vi.fn();
  (container.firstElementChild as HTMLElement).scrollTo = scrollTo;

  const heading = getByRole('heading', { name: 'Target' });
  expect(heading.id).not.toBe('');
  const link = getByRole('link', { name: 'Jump' });
  expect(link.getAttribute('href')).toBe(`#${heading.id}`);
  expect(fireEvent.click(link)).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

// Without a marked container the scroll targets the nearest scrollable ancestor only —
// never scrollIntoView, which walks every ancestor and shoves fixed app chrome around.
it('scrolls only the nearest scrollable ancestor for unmarked containers', () => {
  const { container, getByRole } = render(
    <div style={{ overflowY: 'auto' }}>
      <Markdown>{'## Target\n\n[Jump](#target)'}</Markdown>
    </div>,
  );
  const scroller = container.firstElementChild as HTMLElement;
  Object.defineProperties(scroller, {
    scrollHeight: { value: 200 },
    clientHeight: { value: 100 },
  });
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  expect(fireEvent.click(getByRole('link', { name: 'Jump' }))).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it('prevents navigation for fragment links with no resolvable target', () => {
  const { getByRole } = render(<Markdown>{'[missing](#nowhere)'}</Markdown>);
  const link = getByRole('link', { name: 'missing' });
  expect(link.getAttribute('target')).toBeNull();
  expect(fireEvent.click(link)).toBe(false);
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
