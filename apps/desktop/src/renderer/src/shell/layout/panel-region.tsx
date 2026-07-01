import type { ChromeSurface, PanelWindowType } from '@linkcode/ui/shell/panels';
import { PanelRegion } from '@linkcode/ui/shell/panels';
import { TerminalPanel } from '@linkcode/workbench';
import { DesktopChromePortal } from '../chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from '../chrome/metrics';
import type { PanelSide, PanelState } from '../store/model';
import type { SplitPanePhase } from './use-animated-split';
import { getShellContentMotionStyle } from './use-animated-split';

export function DesktopPanelRegion({
  side,
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  phase,
  reducedMotion,
  onSelectTab,
  onCloseTab,
  onAddWindow,
  onToggleMax,
  onClose,
}: {
  side: PanelSide;
  panel: PanelState;
  maximized: boolean;
  chromeVisible: boolean;
  chromeSurface: ChromeSurface;
  phase: SplitPanePhase;
  reducedMotion: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
  onToggleMax: () => void;
  onClose: () => void;
}): React.ReactNode {
  return (
    <PanelRegion
      side={side}
      panel={panel}
      maximized={maximized}
      chromeVisible={chromeVisible}
      chromeSurface={chromeSurface}
      chromeSpacerClassName={DESKTOP_CHROME_SPACER_CLASS}
      ChromePortal={DesktopChromePortal}
      contentStyle={getShellContentMotionStyle({
        axis: side === 'right' ? 'x' : 'y',
        phase,
        reducedMotion,
      })}
      panelContentByType={{ terminal: () => <TerminalPanel /> }}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onAddWindow={onAddWindow}
      onToggleMax={onToggleMax}
      onClose={onClose}
    />
  );
}
