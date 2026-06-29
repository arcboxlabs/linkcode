const THEME_QUERY = '(prefers-color-scheme: dark)';

export function installAdaptiveTheme(): () => void {
  const media = window.matchMedia(THEME_QUERY);

  function applyTheme(): void {
    document.documentElement.classList.toggle('dark', media.matches);
  }

  applyTheme();
  media.addEventListener('change', applyTheme);

  return () => media.removeEventListener('change', applyTheme);
}
