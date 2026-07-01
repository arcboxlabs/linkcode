import type { ChromeSurface } from './panel-region';
import type { PanelSide } from './vocabulary';

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
