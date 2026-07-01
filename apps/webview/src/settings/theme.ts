import type { ThemePreference } from './store';
import { useSettingsStore } from './store';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function resolveDark(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

function apply(theme: ThemePreference): void {
  document.documentElement.classList.toggle('dark', resolveDark(theme));
}

/**
 * Apply the stored theme immediately and keep the `.dark` class in sync with both the store and the
 * OS (for `system`). Called once at startup before render to avoid a flash. Returns an uninstaller.
 */
export function installTheme(): () => void {
  apply(useSettingsStore.getState().theme);
  const unsubscribe = useSettingsStore.subscribe((state) => apply(state.theme));
  const media = window.matchMedia(DARK_QUERY);
  const onMediaChange = (): void => {
    if (useSettingsStore.getState().theme === 'system') apply('system');
  };
  media.addEventListener('change', onMediaChange);
  return () => {
    unsubscribe();
    media.removeEventListener('change', onMediaChange);
  };
}
