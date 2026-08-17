import type { ThemePreference } from '@mobile/stores/settings-store';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_LABEL_KEY = {
  system: 'appearanceSystem',
  light: 'appearanceLight',
  dark: 'appearanceDark',
} as const;

export const PRIVACY_POLICY_URL = 'https://linkcode.ai/privacy';
export const TERMS_OF_SERVICE_URL = 'https://linkcode.ai/terms';
export const SUPPORT_URL = 'https://linkcode.ai/support';
