import type { Restty } from 'restty';
import { getBuiltinTheme } from 'restty';

// The app has no JS theme state — light/dark is just the `.dark` class on <html>. Match it with a
// builtin ghostty theme so the terminal follows the app's mode instead of restty's default pure black.
const DARK_THEME = 'Dark+';
const LIGHT_THEME = 'GitHub Light Default';

/**
 * Apply the builtin terminal theme matching the app's current light/dark mode. `frame` is the
 * padded wrapper around the restty root: it gets the theme's background color so the breathing
 * room around the canvas reads as part of the terminal, not a gap exposing the app background.
 */
export function applyTerminalTheme(terminal: Restty, frame?: HTMLElement | null): void {
  const dark = document.documentElement.classList.contains('dark');
  const theme = getBuiltinTheme(dark ? DARK_THEME : LIGHT_THEME);
  if (!theme) return;
  terminal.applyTheme(theme);
  const background = theme.colors.background;
  if (frame && background) {
    frame.style.backgroundColor = `rgb(${background.r} ${background.g} ${background.b})`;
  }
}
