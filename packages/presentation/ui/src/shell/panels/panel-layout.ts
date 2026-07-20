import type { ChromeSurface } from './panel-region';
import type { PanelSide } from './vocabulary';

export function getChromeSurface(expandedPanel: PanelSide | null): ChromeSurface {
  if (expandedPanel === 'bottom') return 'bottom-max';
  if (expandedPanel === 'right') return 'right-max';
  return 'normal';
}
