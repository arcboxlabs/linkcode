import type { BundledTheme } from 'streamdown';

/** Curated shiki themes for chat code blocks, split by background. Streamdown renders the
 * [light, dark] pair together and activates the dark member under `.dark`. */
export const CODE_THEME_LIGHT_IDS = [
  'github-light',
  'one-light',
  'catppuccin-latte',
  'vitesse-light',
  'solarized-light',
  'min-light',
] as const satisfies readonly BundledTheme[];

export const CODE_THEME_DARK_IDS = [
  'github-dark',
  'one-dark-pro',
  'dracula',
  'nord',
  'catppuccin-mocha',
  'vitesse-dark',
  'min-dark',
] as const satisfies readonly BundledTheme[];

export type CodeThemeLightId = (typeof CODE_THEME_LIGHT_IDS)[number];
export type CodeThemeDarkId = (typeof CODE_THEME_DARK_IDS)[number];

/** [light, dark] pair passed to Streamdown's `shikiTheme`. */
export type CodeThemePair = [light: CodeThemeLightId, dark: CodeThemeDarkId];

export const DEFAULT_CODE_THEME: CodeThemePair = ['github-light', 'github-dark'];

/** Display names (proper nouns — not translated). */
export const CODE_THEME_LABELS: Record<CodeThemeLightId | CodeThemeDarkId, string> = {
  'github-light': 'GitHub Light',
  'one-light': 'One Light',
  'catppuccin-latte': 'Catppuccin Latte',
  'vitesse-light': 'Vitesse Light',
  'solarized-light': 'Solarized Light',
  'min-light': 'Min Light',
  'github-dark': 'GitHub Dark',
  'one-dark-pro': 'One Dark Pro',
  dracula: 'Dracula',
  nord: 'Nord',
  'catppuccin-mocha': 'Catppuccin Mocha',
  'vitesse-dark': 'Vitesse Dark',
  'min-dark': 'Min Dark',
};
