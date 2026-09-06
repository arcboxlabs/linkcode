// @vitest-environment jsdom

import type { ContentBlock } from '@linkcode/schema';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactHostActionsContext } from '../artifacts/host-actions';
import { AttachmentPreviewProvider, resetAttachmentPreviews } from '../attachment-preview';
import { ContentBlockView } from '../content-block-view';

vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(() => {
  cleanup();
  resetAttachmentPreviews();
});

function resourceLink(uri: string): ContentBlock {
  return { type: 'resource_link', uri, name: 'ARCHITECTURE.md' };
}

it('uses the preserved attachment name for an image preview', () => {
  const { getByRole } = render(
    <ContentBlockView
      block={{
        type: 'image',
        data: 'cG5n',
        mimeType: 'image/png',
        name: 'architecture.png',
      }}
    />,
  );

  const image = getByRole('img', { name: 'architecture.png' });
  expect(image.getAttribute('title')).toBe('architecture.png');
  expect(image.getAttribute('src')).toBe('data:image/png;base64,cG5n');
});

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

it('renders web resource links with favicon candidates', () => {
  const { getByRole } = render(
    <ContentBlockView block={resourceLink('https://example.com/doc')} />,
  );
  const link = getByRole('link', { name: 'ARCHITECTURE.md' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.querySelectorAll('img')).toHaveLength(2);
  expect(link.querySelector('svg')).not.toBeNull();
});

it('renders a stored image as an attachment card when no preview resolver is mounted', () => {
  const { getByText, queryByRole } = render(
    <ContentBlockView
      block={{
        type: 'resource_link',
        uri: 'attachment:att-1',
        name: 'shot.png',
        mimeType: 'image/png',
        size: 12,
        description: 'image',
      }}
    />,
  );
  expect(queryByRole('img')).toBeNull();
  expect(queryByRole('link')).toBeNull();
  expect(getByText('shot.png').closest('[data-slot="attachment-card"]')).not.toBeNull();
  expect(getByText('image/png')).toBeDefined();
});

it('does not fetch bytes for a non-image stored attachment', () => {
  const resolve = vi.fn();
  const { getByText, queryByRole } = render(
    <AttachmentPreviewProvider resolve={resolve}>
      <ContentBlockView
        block={{
          type: 'resource_link',
          uri: 'attachment:att-2',
          name: 'notes.bin',
          description: 'custom-kind',
        }}
      />
    </AttachmentPreviewProvider>,
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(queryByRole('img')).toBeNull();
  expect(getByText('notes.bin').closest('[data-slot="attachment-card"]')).not.toBeNull();
});

it('renders a stored image from the preview resolver', async () => {
  const { findByRole } = render(
    <AttachmentPreviewProvider resolve={() => Promise.resolve({ url: 'blob:preview' })}>
      <ContentBlockView
        block={{
          type: 'resource_link',
          uri: 'attachment:att-1',
          name: 'shot.png',
          description: 'image',
        }}
      />
    </AttachmentPreviewProvider>,
  );
  const image = await findByRole('img', { name: 'shot.png' });
  expect(image.getAttribute('src')).toBe('blob:preview');
});

it('marks a stored image unavailable when its bytes are gone but its record survives', async () => {
  const { findByText } = render(
    <AttachmentPreviewProvider resolve={() => Promise.resolve(null)}>
      <ContentBlockView
        block={{
          type: 'resource_link',
          uri: 'attachment:att-1',
          name: 'shot.png',
          mimeType: 'image/png',
          size: 12,
          description: 'image',
        }}
      />
    </AttachmentPreviewProvider>,
  );
  expect(await findByText('attachmentUnavailable')).toBeDefined();
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
