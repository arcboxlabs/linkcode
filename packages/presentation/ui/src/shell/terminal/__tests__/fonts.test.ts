// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { resolveTerminalFonts } from '../fonts';

describe('resolveTerminalFonts', () => {
  it('preserves the Window receiver while probing local fallbacks', async () => {
    const queryLocalFonts = vi.fn(function (this: Window) {
      expect(this).toBe(window);
      return Promise.resolve([
        {
          family: 'Hiragino Sans GB',
          fullName: 'Hiragino Sans GB W3',
          postscriptName: 'HiraginoSansGB-W3',
        },
        {
          family: 'Apple Color Emoji',
          fullName: 'Apple Color Emoji',
          postscriptName: 'AppleColorEmoji',
        },
      ]);
    });
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: queryLocalFonts,
    });

    const fonts = await resolveTerminalFonts('code-150-test');
    const families = fonts.flatMap((font) =>
      typeof font === 'object' && 'family' in font ? [font.family] : [],
    );

    expect(queryLocalFonts).toHaveBeenCalledOnce();
    expect(families).toContain('Hiragino Sans GB');
    expect(families).toContain('Apple Color Emoji');
  });
});
