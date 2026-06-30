import type { BrowserWindowConstructorOptions } from 'electron';
import { nativeTheme } from 'electron';

const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';
// Keep in sync with coss-ui's light/dark `--sidebar` tokens used by `bg-sidebar`.
const SIDEBAR_LIGHT_WINDOW_BACKGROUND = '#fafafa';
const SIDEBAR_DARK_WINDOW_BACKGROUND = '#09090b';

export function desktopBackgroundColor(): string {
  if (process.platform === 'darwin') {
    return TRANSPARENT_WINDOW_BACKGROUND;
  }

  return nativeTheme.shouldUseDarkColors
    ? SIDEBAR_DARK_WINDOW_BACKGROUND
    : SIDEBAR_LIGHT_WINDOW_BACKGROUND;
}

export function desktopBackdropOptions(): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial' | 'transparent' | 'vibrancy' | 'visualEffectState'
> {
  if (process.platform === 'darwin') {
    return {
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      transparent: true,
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    };
  }

  if (process.platform === 'win32') {
    return {
      backgroundColor: desktopBackgroundColor(),
      backgroundMaterial: 'acrylic',
    };
  }

  return {
    backgroundColor: desktopBackgroundColor(),
  };
}
