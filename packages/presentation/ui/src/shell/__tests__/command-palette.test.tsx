// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setKeyboardShortcutPlatform, useKeyboardShortcutListener } from '../../keyboard';
import { CommandPalette } from '../command-palette';

const ANIMATION_CLASS_PATTERN = /animate|duration|transition/;

function translate(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations() {
    return translate;
  },
}));

function PaletteHarness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  useKeyboardShortcutListener();
  return (
    <CommandPalette
      onOpenChange={onOpenChange}
      query=""
      onQueryChange={vi.fn()}
      threads={[]}
      commands={[]}
      onSelectThread={vi.fn()}
      onRunCommand={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('CommandPalette', () => {
  it('renders immediately with a dark backdrop and no animation classes', () => {
    const { container } = render(<PaletteHarness onOpenChange={vi.fn()} />);
    const backdrop = container.ownerDocument.querySelector('[data-slot="command-dialog-backdrop"]');
    const popup = container.ownerDocument.querySelector('[data-slot="command-dialog-popup"]');

    expect(backdrop?.classList.contains('bg-black/32')).toBe(true);
    expect(backdrop?.className).not.toMatch(ANIMATION_CLASS_PATTERN);
    expect(popup?.className).not.toMatch(ANIMATION_CLASS_PATTERN);
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(<PaletteHarness onOpenChange={onOpenChange} />);

    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('closes when Command+K is pressed again', () => {
    setKeyboardShortcutPlatform('mac');
    const onOpenChange = vi.fn();
    render(<PaletteHarness onOpenChange={onOpenChange} />);

    fireEvent.keyDown(document, { code: 'KeyK', key: 'k', metaKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
