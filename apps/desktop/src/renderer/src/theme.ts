import { noop } from 'foxact/noop';

const THEME_QUERY = '(prefers-color-scheme: dark)';

export function installAdaptiveTheme(): () => void {
  const media = document.defaultView?.matchMedia(THEME_QUERY);
  if (!media) return noop;
  const colorSchemeMedia = media;

  function applyTheme(): void {
    document.documentElement.classList.toggle('dark', colorSchemeMedia.matches);
  }

  applyTheme();
  colorSchemeMedia.addEventListener('change', applyTheme);

  return () => colorSchemeMedia.removeEventListener('change', applyTheme);
}
