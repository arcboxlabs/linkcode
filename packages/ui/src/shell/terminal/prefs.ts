import type { ResttyBuiltinThemeName } from 'restty';

/**
 * Monospace family the terminal renders in — a free-form family name, or empty for the bundled IBM
 * Plex Mono chain. A named family is prepended to that chain (`local: 'prefer'`) so a machine that
 * lacks it falls back cleanly. The list seeds the field's suggestions; any other name is accepted.
 */
export const TERMINAL_FONT_SUGGESTIONS = [
  'SF Mono',
  'Menlo',
  'Monaco',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Hack',
  'Source Code Pro',
  'IBM Plex Mono',
] as const;
export const DEFAULT_TERMINAL_FONT_FAMILY = '';

/** Terminal font size in CSS pixels. */
export const TERMINAL_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20] as const;
export type TerminalFontSize = (typeof TERMINAL_FONT_SIZES)[number];
export const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** Named restty builtin ghostty themes offered as fixed color schemes (`satisfies` pins each name). */
const TERMINAL_NAMED_SCHEMES = [
  'GitHub Dark Default',
  'GitHub Light Default',
  'Dracula',
  'Nord',
  'Catppuccin Mocha',
  'Catppuccin Latte',
  'One Half Dark',
  'One Half Light',
  'Gruvbox Dark',
] as const satisfies readonly ResttyBuiltinThemeName[];

/** `'auto'` follows the app light/dark mode (default); a named scheme applies regardless of mode. */
export const TERMINAL_COLOR_SCHEMES = ['auto', ...TERMINAL_NAMED_SCHEMES] as const;
export type TerminalColorScheme = (typeof TERMINAL_COLOR_SCHEMES)[number];
export const DEFAULT_TERMINAL_COLOR_SCHEME: TerminalColorScheme = 'auto';
