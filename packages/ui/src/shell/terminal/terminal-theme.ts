import type { Restty } from 'restty';
import { getBuiltinTheme } from 'restty';
import type { TerminalColorScheme } from './prefs';

// The app has no JS theme state — light/dark is just the `.dark` class on <html>. The `'auto'`
// scheme matches it with a builtin ghostty theme so the terminal follows the app's mode instead of
// restty's default pure black; a named scheme applies that theme regardless of the app mode.
const DARK_THEME = 'Dark+';
const LIGHT_THEME = 'GitHub Light Default';

/**
 * Apply a terminal color scheme. With `'auto'` the theme tracks the app's current light/dark mode.
 * `frame` is the padded wrapper around the restty root: it gets the theme's background color so the
 * breathing room around the canvas reads as part of the terminal, not a gap exposing the app background.
 */
export function applyTerminalTheme(
  terminal: Restty,
  frame?: HTMLElement | null,
  colorScheme: TerminalColorScheme = 'auto',
): void {
  const name =
    colorScheme === 'auto'
      ? document.documentElement.classList.contains('dark')
        ? DARK_THEME
        : LIGHT_THEME
      : colorScheme;
  const theme = getBuiltinTheme(name);
  if (!theme) return;
  terminal.applyTheme(theme);
  const background = theme.colors.background;
  if (frame && background) {
    frame.style.backgroundColor = `rgb(${background.r} ${background.g} ${background.b})`;
  }
}
