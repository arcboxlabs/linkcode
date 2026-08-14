// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandBrandGlyph } from '../command-brand';

afterEach(cleanup);

describe('CommandBrandGlyph', () => {
  it('uses dark text on light brand colors and white text on dark ones', () => {
    const { container, rerender } = render(
      <CommandBrandGlyph command={{ name: 'light', brandColor: '#FFFFFF' }} />,
    );
    expect(container.querySelector('span')?.style.color).toBe('rgb(0, 0, 0)');

    rerender(<CommandBrandGlyph command={{ name: 'dark', brandColor: '#111827' }} />);
    expect(container.querySelector('span')?.style.color).toBe('rgb(255, 255, 255)');
  });

  it('falls back to the branded initial after an image error and resets for a new image', () => {
    const { container, rerender } = render(
      <CommandBrandGlyph
        command={{
          name: 'documents',
          displayName: 'Documents',
          brandColor: '#FFFFFF',
          iconDataUri: 'data:image/png;base64,first',
        }}
      />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')?.textContent).toBe('D');

    rerender(
      <CommandBrandGlyph
        command={{
          name: 'documents',
          displayName: 'Documents',
          brandColor: '#FFFFFF',
          iconDataUri: 'data:image/png;base64,second',
        }}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,second',
    );
  });

  it('falls back to the default book glyph when an image has no brand color', () => {
    const { container } = render(
      <CommandBrandGlyph
        command={{ name: 'plain', iconDataUri: 'data:image/png;base64,broken' }}
      />,
    );
    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('svg.lucide-book-text')).not.toBeNull();
  });
});
