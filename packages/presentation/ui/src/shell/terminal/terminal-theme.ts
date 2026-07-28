import type { Restty } from 'restty';
import { getBuiltinTheme } from 'restty';
import type { TerminalColorScheme } from './prefs';

// Light/dark is just the `.dark` class on <html>; `'auto'` tracks it with a builtin ghostty theme
// (instead of restty's default pure black), while a named scheme applies regardless of app mode.
const DARK_THEME = 'Dark+';
const LIGHT_THEME = 'GitHub Light Default';

/** Apply a terminal color scheme (`'auto'` tracks the app's light/dark mode). `frame`, the padded
 * wrapper, gets the theme background so the padding reads as terminal, not a gap. */
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
