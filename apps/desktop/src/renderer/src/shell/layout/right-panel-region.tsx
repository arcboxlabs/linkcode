import type { ThemePreference } from '@linkcode/ipc';
import type { SessionId } from '@linkcode/schema';
import type { ChromeSurface, OptionalPanelSection, PanelSection } from '@linkcode/ui/shell/panels';
import { SectionPanelRegion } from '@linkcode/ui/shell/panels';
import { FilesPanel, GitPanel, SimulatorPanel } from '@linkcode/workbench';
import { DesktopChromePortal } from '../chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from '../chrome/metrics';
import type { RightPanelState } from '../store/model';

/**
 * Desktop right-panel chrome/frame. The Terminal section's PTY stack is NOT rendered here: the
 * shell owns it and portals a `PanelTabContentStack` into the box this region reports via
 * `terminalContentTargetRef`, so terminals survive the docked ↔ maximized instance handoff without
 * remounting. Diff/Browser section content is stateless and stays inline.
 */
export function DesktopRightPanelRegion({
  panel,
  cwd,
  activeSessionId,
  themeType,
  maximized,
  chromeVisible,
  contentHidden,
  chromeSurface,
  terminalContentTargetRef,
  onSelectSection,
  onAddSection,
  onCloseSection,
  onSelectTerminalTab,
  onCloseTerminalTab,
  onAddTerminalTab,
  onSelectFileTab,
  onCloseFileTab,
  onOpenFileTab,
  onToggleMax,
}: {
  panel: RightPanelState;
  cwd: string | undefined;
  /** The active thread — simulator interactions ride its session claim. */
  activeSessionId: SessionId | null;
  themeType: ThemePreference;
  maximized: boolean;
  chromeVisible: boolean;
  contentHidden: boolean;
  chromeSurface: ChromeSurface;
  terminalContentTargetRef: (element: HTMLDivElement | null) => void;
  onSelectSection: (section: PanelSection) => void;
  onAddSection: (section: OptionalPanelSection) => void;
  onCloseSection: (section: OptionalPanelSection) => void;
  onSelectTerminalTab: (id: string) => void;
  onCloseTerminalTab: (id: string) => void;
  onAddTerminalTab: () => void;
  onSelectFileTab: (id: string) => void;
  onCloseFileTab: (id: string) => void;
  onOpenFileTab: (path: string) => void;
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
      sectionContent={{
        diff: <GitPanel cwd={cwd} themeType={themeType} />,
        // browser intentionally absent: the webview lives in the shell's resident
        // content stack (a DOM-moved webview reloads) and shows through this section.
        files: (
          <FilesPanel
            cwd={cwd}
            tabs={panel.files.tabs}
            activeTabId={panel.files.activeTabId}
            themeType={themeType}
            onSelectTab={onSelectFileTab}
            onCloseTab={onCloseFileTab}
            onOpenFile={onOpenFileTab}
          />
        ),
        simulator: <SimulatorPanel sessionId={activeSessionId} />,
      }}
      terminalContentTargetRef={terminalContentTargetRef}
      onSelectSection={onSelectSection}
      onAddSection={onAddSection}
      onCloseSection={onCloseSection}
      onSelectTerminalTab={onSelectTerminalTab}
      onCloseTerminalTab={onCloseTerminalTab}
      onAddTerminalTab={onAddTerminalTab}
      onToggleMax={onToggleMax}
    />
  );
}
