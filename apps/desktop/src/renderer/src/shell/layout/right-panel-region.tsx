import type { ChromeSurface, PanelSection } from '@linkcode/ui/shell/panels';
import { PanelStubContent, SectionPanelRegion } from '@linkcode/ui/shell/panels';
import { GitPanel, TerminalPanel } from '@linkcode/workbench';
import { DesktopChromePortal } from '../chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from '../chrome/metrics';
import type { RightPanelState } from '../store/model';
import type { SplitPanePhase } from './use-animated-split';
import { getShellContentMotionStyle } from './use-animated-split';

export function DesktopRightPanelRegion({
  panel,
  cwd,
  maximized,
  chromeVisible,
  contentHidden,
  chromeSurface,
  phase,
  reducedMotion,
  onSelectSection,
  onSelectTerminalTab,
  onCloseTerminalTab,
  onAddTerminalTab,
  onToggleMax,
}: {
  panel: RightPanelState;
  cwd: string | undefined;
  maximized: boolean;
  chromeVisible: boolean;
  contentHidden: boolean;
  chromeSurface: ChromeSurface;
  phase: SplitPanePhase;
  reducedMotion: boolean;
  onSelectSection: (section: PanelSection) => void;
  onSelectTerminalTab: (id: string) => void;
  onCloseTerminalTab: (id: string) => void;
  onAddTerminalTab: () => void;
  onToggleMax: () => void;
}): React.ReactNode {
  return (
    <SectionPanelRegion
      panel={panel}
      maximized={maximized}
      chromeVisible={chromeVisible}
      chromeSurface={chromeSurface}
      contentHidden={contentHidden}
      chromeSpacerClassName={DESKTOP_CHROME_SPACER_CLASS}
      ChromePortal={DesktopChromePortal}
      contentStyle={getShellContentMotionStyle({ axis: 'x', phase, reducedMotion })}
      sectionContent={{
        diff: <GitPanel cwd={cwd} />,
        browser: <PanelStubContent type="browser" />,
      }}
      terminalTabs={panel.terminal.tabs.map((tab) => ({
        id: tab.id,
        node: <TerminalPanel sessionKey={tab.id} suspended={phase !== 'open'} />,
      }))}
      onSelectSection={onSelectSection}
      onSelectTerminalTab={onSelectTerminalTab}
      onCloseTerminalTab={onCloseTerminalTab}
      onAddTerminalTab={onAddTerminalTab}
      onToggleMax={onToggleMax}
    />
  );
}
