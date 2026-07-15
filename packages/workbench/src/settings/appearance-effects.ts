import type { AppearancePrefsState, TextSize } from './appearance-store';
import { useAppearancePrefsStore } from './appearance-store';

/**
 * Root font size per text-size preference. `default` clears the inline size so the stylesheet/UA
 * default applies; `small`/`large` scale every rem-based utility proportionally.
 */
const TEXT_SIZE_ROOT_PX: Record<TextSize, string> = {
  small: '14px',
  default: '',
  large: '18px',
};

function applyAppearancePrefs(state: AppearancePrefsState): void {
  document.documentElement.style.fontSize = TEXT_SIZE_ROOT_PX[state.textSize];
  // Drives the CSS `.reduce-motion` reset in styles.css; JS-driven motion opts out via RenderPrefs.
  document.documentElement.classList.toggle('reduce-motion', state.reduceMotion);
}

/**
 * Apply the persisted appearance preferences to the document root and keep them in sync with the
 * store. Called once per renderer at startup (before first paint). Returns an uninstaller.
 */
export function installAppearancePrefs(): () => void {
  applyAppearancePrefs(useAppearancePrefsStore.getState());
  return useAppearancePrefsStore.subscribe(applyAppearancePrefs);
}
