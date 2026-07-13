import type { ThemePreference } from '@linkcode/ipc';
import type { ChromeSurface, PanelSection } from '@linkcode/ui/shell/panels';
import { SectionPanelRegion } from '@linkcode/ui/shell/panels';
import { FilesPanel, GitPanel } from '@linkcode/workbench';
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
  themeType,
  maximized,
  chromeVisible,
  contentHidden,
  chromeSurface,
  terminalContentTargetRef,
  onSelectSection,
  onSelectTerminalTab,
  onCloseTerminalTab,
  onAddTerminalTab,
  onSelectFileTab,
  onCloseFileTab,
  onToggleMax,
}: {
  panel: RightPanelState;
  cwd: string | undefined;
  themeType: ThemePreference;
  maximized: boolean;
  chromeVisible: boolean;
  contentHidden: boolean;
  chromeSurface: ChromeSurface;
  terminalContentTargetRef: (element: HTMLDivElement | null) => void;
  onSelectSection: (section: PanelSection) => void;
  onSelectTerminalTab: (id: string) => void;
  onCloseTerminalTab: (id: string) => void;
  onAddTerminalTab: () => void;
  onSelectFileTab: (id: string) => void;
  onCloseFileTab: (id: string) => void;
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
            onSelectTab={onSelectFileTab}
            onCloseTab={onCloseFileTab}
          />
        ),
      }}
      terminalContentTargetRef={terminalContentTargetRef}
      onSelectSection={onSelectSection}
      onSelectTerminalTab={onSelectTerminalTab}
      onCloseTerminalTab={onCloseTerminalTab}
      onAddTerminalTab={onAddTerminalTab}
      onToggleMax={onToggleMax}
    />
  );
}
