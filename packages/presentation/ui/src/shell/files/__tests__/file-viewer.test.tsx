// @vitest-environment jsdom

import type { WorkspaceFile } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../file-viewer';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

function fileFixture(path: string, mimeType: string): WorkspaceFile {
  return {
    path,
    size: 4,
    mtimeMs: 1,
    encoding: 'base64',
    content: 'YWJj/w==',
    mimeType,
  };
}

describe('FileViewer', () => {
  it.each([
    'invalid.txt',
    'invalid.md',
    'invalid.json',
  ])('does not render a base64 payload through the %s text viewer', (path) => {
    const file = fileFixture(path, 'text/plain');
    render(<FileViewer path={path} file={file} isLoading={false} />);

    expect(screen.getByText('unsupported')).toBeTruthy();
    expect(screen.queryByText(file.content)).toBeNull();
  });

  it('continues to render base64 images', () => {
    const file = fileFixture('image.png', 'image/png');
    render(<FileViewer path={file.path} file={file} isLoading={false} />);

    expect(screen.getByRole('img', { name: file.path }).getAttribute('src')).toBe(
      `data:image/png;base64,${file.content}`,
    );
  });
});
