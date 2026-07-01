import type { PanelSide } from './panel-region';

export type ChromeSurface = 'normal' | 'right-max' | 'bottom-max';

export function getChromeSurface(expandedPanel: PanelSide | null): ChromeSurface {
  if (expandedPanel === 'bottom') return 'bottom-max';
  if (expandedPanel === 'right') return 'right-max';
  return 'normal';
}

export function getWorkspaceMinSize({
  rightPanelOpen,
  rightAllowZeroSize,
  minMainSize,
  rightPanelMinSize,
}: {
  rightPanelOpen: boolean;
  rightAllowZeroSize: boolean;
  minMainSize: number;
  rightPanelMinSize: number;
}): number {
  return rightPanelOpen && !rightAllowZeroSize ? minMainSize + rightPanelMinSize : minMainSize;
}
