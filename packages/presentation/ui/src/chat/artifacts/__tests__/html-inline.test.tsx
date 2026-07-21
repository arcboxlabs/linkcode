// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactHostActionsProvider } from '../context';
import { HtmlInline } from '../html-inline';
import type { InlineArtifact } from '../types';

const TRANSLATIONS: Record<string, string> = {
  expandPreview: 'Preview',
  hostFailed: 'Failed to host the preview',
  openInPanel: 'Open in panel',
};

function translateKey(key: string): string {
  return TRANSLATIONS[key] ?? key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

const artifact: InlineArtifact = {
  kind: 'html',
  detectorId: 'builtin',
  source: { type: 'inline', language: 'html', text: '<main>Hello</main>' },
};

it('places the ghost Preview action in the source header before Copy', async () => {
  const user = userEvent.setup();
  const hostArtifact = vi.fn().mockResolvedValue({ url: 'http://artifact.localhost:3000' });
  const { container } = render(
    <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), hostArtifact }}>
      <HtmlInline artifact={artifact} isIncomplete={false} />
    </ArtifactHostActionsProvider>,
  );

  const preview = screen.getByRole('button', { name: 'Preview' });
  const header = preview.closest('[data-slot="card-header"]');
  const actions = preview.parentElement;
  expect(header).not.toBeNull();
  expect(preview.className).toContain('border-transparent');
  expect(actions?.lastElementChild?.getAttribute('aria-label')).toBe('Copy');
  expect(container.querySelector('[data-slot="card"] + div')).toBeNull();
  await waitFor(
    () => {
      expect(container.querySelectorAll('code span[style*="--sdm-c"]').length).toBeGreaterThan(2);
    },
    { timeout: 10000 },
  );

  preview.focus();
  await user.keyboard('{Enter}');
  expect(hostArtifact).toHaveBeenCalledWith(artifact.source.text, 'text/html; charset=utf-8');
  expect(await screen.findByTitle('html artifact')).toBeDefined();
}, 15000);

it('keeps a hosting failure visible in the source header', async () => {
  const user = userEvent.setup();
  const hostArtifact = vi.fn().mockRejectedValue(new Error('offline'));
  render(
    <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), hostArtifact }}>
      <HtmlInline artifact={artifact} isIncomplete={false} />
    </ArtifactHostActionsProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'Preview' }));
  const failure = await screen.findByText('Failed to host the preview');
  expect(failure.closest('[data-slot="card-header"]')).not.toBeNull();
});
