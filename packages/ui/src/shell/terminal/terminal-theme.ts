import type { Restty } from 'restty';
import { getBuiltinTheme } from 'restty';

// The app has no JS theme state — light/dark is just the `.dark` class on <html>. Match it with a
// builtin ghostty theme so the terminal follows the app's mode instead of restty's default pure black.
const DARK_THEME = 'Dark+';
const LIGHT_THEME = 'GitHub Light Default';

/** Apply the builtin terminal theme matching the app's current light/dark mode. */
export function applyTerminalTheme(terminal: Restty): void {
  const dark = document.documentElement.classList.contains('dark');
  const theme = getBuiltinTheme(dark ? DARK_THEME : LIGHT_THEME);
  if (theme) terminal.applyTheme(theme);
}
