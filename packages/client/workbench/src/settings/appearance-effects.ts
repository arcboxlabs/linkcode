import type { AppearancePrefsState, TextSize } from './appearance-store';
import { useAppearancePrefsStore } from './appearance-store';

/** Root font size per text-size preference. `default` clears the inline size so the stylesheet/UA
 * default applies; `small`/`large` scale every rem-based utility proportionally. */
const TEXT_SIZE_ROOT_PX: Record<TextSize, string> = {
  small: '14px',
  default: '',
  large: '18px',
};

// Base font stacks (mirroring styles.css `:root`); a user override is prepended so a family the
// machine lacks degrades to the bundled fonts.
const BASE_SANS =
  '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const BASE_MONO =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function applyFontOverride(property: '--font-sans' | '--font-mono', family: string): void {
  const trimmed = family.trim();
  if (trimmed === '') {
    document.documentElement.style.removeProperty(property);
    return;
  }
  const base = property === '--font-sans' ? BASE_SANS : BASE_MONO;
  document.documentElement.style.setProperty(property, `"${trimmed}", ${base}`);
}

function applyAppearancePrefs(state: AppearancePrefsState): void {
  document.documentElement.style.fontSize = TEXT_SIZE_ROOT_PX[state.textSize];
  // Drives the CSS `.reduce-motion` reset in styles.css; JS-driven motion opts out via RenderPrefs.
  document.documentElement.classList.toggle('reduce-motion', state.reduceMotion);
  applyFontOverride('--font-sans', state.uiFont);
  applyFontOverride('--font-mono', state.codeFont);
}

/** Apply persisted appearance prefs to the document root and keep them synced with the store.
 * Called once per renderer before first paint; returns an uninstaller. */
export function installAppearancePrefs(): () => void {
  applyAppearancePrefs(useAppearancePrefsStore.getState());
  return useAppearancePrefsStore.subscribe(applyAppearancePrefs);
}
