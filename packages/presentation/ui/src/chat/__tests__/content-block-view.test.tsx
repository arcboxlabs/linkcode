// @vitest-environment jsdom

import type { ContentBlock } from '@linkcode/schema';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactHostActionsContext } from '../artifacts/host-actions';
import { ContentBlockView } from '../content-block-view';

vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

function resourceLink(uri: string): ContentBlock {
  return { type: 'resource_link', uri, name: 'ARCHITECTURE.md' };
}

// The pre-chip renderer emitted a target=_blank anchor whose file:// href was blocked from
// http(s) origins — a dead click. File uris must route the artifact host actions instead.
it('opens file resource links through the artifact host actions', () => {
  const openFile = vi.fn();
  const { getByRole } = render(
    <ArtifactHostActionsContext.Provider value={{ referenceToComposer: vi.fn(), openFile }}>
      <ContentBlockView block={resourceLink('file:///mock/linkcode/docs/ARCHITECTURE.md')} />
    </ArtifactHostActionsContext.Provider>,
  );
  fireEvent.click(getByRole('button', { name: 'ARCHITECTURE.md' }));
  expect(openFile).toHaveBeenCalledWith('/mock/linkcode/docs/ARCHITECTURE.md');
});

it('renders web resource links without remote favicon requests', () => {
  const { getByRole } = render(
    <ContentBlockView block={resourceLink('https://example.com/doc')} />,
  );
  const link = getByRole('link', { name: 'ARCHITECTURE.md' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.querySelector('img')).toBeNull();
  expect(link.querySelector('svg')).not.toBeNull();
});

it('renders unknown-scheme resource links as inert chips titled by uri', () => {
  const { getByText, queryByRole } = render(
    <ContentBlockView block={resourceLink('mock://notes/showcase.md')} />,
  );
  expect(queryByRole('link')).toBeNull();
  expect(queryByRole('button')).toBeNull();
  const chip = getByText('ARCHITECTURE.md').closest('[data-slot="badge"]');
  expect(chip?.getAttribute('title')).toBe('mock://notes/showcase.md');
});
