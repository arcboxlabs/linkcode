import type { ChromeSurface, PanelWindowType } from '@linkcode/ui/shell/panels';
import { PanelRegion } from '@linkcode/ui/shell/panels';
import { DesktopChromePortal } from '../chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from '../chrome/metrics';
import type { PanelSide, PanelState } from '../store/model';
import type { SplitPanePhase } from './use-animated-split';
import { getShellContentMotionStyle } from './use-animated-split';

/**
 * Desktop panel chrome/frame. Tab content is NOT rendered here: the shell owns it and portals a
 * `PanelTabContents` into the box this region reports via `contentTargetRef`, so stateful tabs
 * (terminals) survive the docked ↔ maximized instance handoff without remounting.
 */
export function DesktopPanelRegion({
  side,
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  contentHidden,
  phase,
  reducedMotion,
  contentTargetRef,
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
  contentHidden: boolean;
  phase: SplitPanePhase;
  reducedMotion: boolean;
  contentTargetRef: (element: HTMLDivElement | null) => void;
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
      contentHidden={contentHidden}
      chromeSpacerClassName={DESKTOP_CHROME_SPACER_CLASS}
      ChromePortal={DesktopChromePortal}
      contentStyle={getShellContentMotionStyle({
        axis: side === 'right' ? 'x' : 'y',
        phase,
        reducedMotion,
      })}
      contentTargetRef={contentTargetRef}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onAddWindow={onAddWindow}
      onToggleMax={onToggleMax}
      onClose={onClose}
    />
  );
}
