export const DESKTOP_CHROME_METRICS = {
  height: 48,
  edgePadding: 16,
  controlGap: 4,
  sectionGap: 8,
  nativeTrafficInset: 80,
  // Right-edge space the persistent Windows/Linux window controls occupy (3 icon-xs buttons +
  // gaps); the chrome reserves it so the panel toggles never sit under the floating controls.
  windowControlsInset: 88,
  leftRailWidth: 188,
  rightRailWidth: 92,
} as const;

export const DESKTOP_CHROME_SPACER_CLASS = 'h-(--lc-chrome-h)';

export type DesktopChromeMetricsStyle = React.CSSProperties & {
  '--lc-chrome-h': string;
  '--lc-chrome-edge': string;
  '--lc-chrome-control-gap': string;
  '--lc-chrome-section-gap': string;
  '--lc-chrome-traffic-inset': string;
  '--lc-chrome-window-controls-inset': string;
  '--lc-chrome-left-rail-w': string;
  '--lc-chrome-right-rail-w': string;
  '--lc-chrome-left-local-inset': string;
  '--lc-chrome-right-local-inset': string;
};

export const DESKTOP_CHROME_METRICS_STYLE = {
  '--lc-chrome-h': `${DESKTOP_CHROME_METRICS.height}px`,
  '--lc-chrome-edge': `${DESKTOP_CHROME_METRICS.edgePadding}px`,
  '--lc-chrome-control-gap': `${DESKTOP_CHROME_METRICS.controlGap}px`,
  '--lc-chrome-section-gap': `${DESKTOP_CHROME_METRICS.sectionGap}px`,
  '--lc-chrome-traffic-inset': `${DESKTOP_CHROME_METRICS.nativeTrafficInset}px`,
  '--lc-chrome-window-controls-inset': `${DESKTOP_CHROME_METRICS.windowControlsInset}px`,
  '--lc-chrome-left-rail-w': `${DESKTOP_CHROME_METRICS.leftRailWidth}px`,
  '--lc-chrome-right-rail-w': `${DESKTOP_CHROME_METRICS.rightRailWidth}px`,
  '--lc-chrome-left-local-inset': `${DESKTOP_CHROME_METRICS.edgePadding}px`,
  '--lc-chrome-right-local-inset': `${DESKTOP_CHROME_METRICS.edgePadding}px`,
} satisfies DesktopChromeMetricsStyle;
