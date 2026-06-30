import { MIN_MAIN_SIZE, RIGHT_PANEL_MIN_SIZE } from '../state/local/model';
import type { PanelSide } from '../state/local/model';

export type ChromeSurface = 'normal' | 'right-max' | 'bottom-max';

export function getChromeSurface(expandedPanel: PanelSide | null): ChromeSurface {
  if (expandedPanel === 'bottom') return 'bottom-max';
  if (expandedPanel === 'right') return 'right-max';
  return 'normal';
}

export function getWorkspaceMinSize({
  rightPanelOpen,
  rightAllowZeroSize,
}: {
  rightPanelOpen: boolean;
  rightAllowZeroSize: boolean;
}): number {
  return rightPanelOpen && !rightAllowZeroSize
    ? MIN_MAIN_SIZE + RIGHT_PANEL_MIN_SIZE
    : MIN_MAIN_SIZE;
}
