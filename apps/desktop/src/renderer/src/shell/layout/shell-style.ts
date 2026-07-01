import type React from 'react';
import type { DesktopChromeMetricsStyle } from '../chrome/metrics';
import { DESKTOP_CHROME_METRICS_STYLE } from '../chrome/metrics';
import type { DesktopShellState } from '../store/model';

export type DesktopShellStyle = React.CSSProperties &
  DesktopChromeMetricsStyle & {
    '--lc-sidebar-w': string;
    '--lc-right-w': string;
    '--lc-bottom-h': string;
  };

export type DesktopShellPaneCssProperty = '--lc-sidebar-w' | '--lc-right-w' | '--lc-bottom-h';

export function createDesktopShellStyle(state: DesktopShellState): DesktopShellStyle {
  return {
    ...DESKTOP_CHROME_METRICS_STYLE,
    '--lc-sidebar-w': `${state.sidebarOpen ? state.layout.sidebarW : 0}px`,
    '--lc-right-w': `${state.rightPanel.open ? state.layout.rightW : 0}px`,
    '--lc-bottom-h': `${state.bottomPanel.open ? state.layout.bottomH : 0}px`,
  };
}

export function setShellPaneCssSize(
  element: HTMLElement | null,
  property: DesktopShellPaneCssProperty,
  size: number,
): void {
  element?.style.setProperty(property, `${Math.max(0, size)}px`);
}
