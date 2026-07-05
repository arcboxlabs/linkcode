import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import type { ChromeSurface, PanelChromePortalProps } from './chrome-portal';
import { getPanelChromePlacement, PanelContextualChromePortal } from './chrome-portal';
import { PanelContextualControls } from './panel-controls';
import { SectionTerminalTabStrip } from './section-terminal-tabs';
import type { PanelSection, PanelSectionTab } from './vocabulary';
import {
  PANEL_SECTIONS,
  PANEL_TAB_ACTIVE_CLASSNAME,
  PANEL_TAB_INACTIVE_CLASSNAME,
  PANEL_WINDOW_ICONS,
} from './vocabulary';

export interface SectionPanelState {
  open: boolean;
  activeSection: PanelSection;
  terminal: {
    tabs: PanelSectionTab[];
    activeTabId: string | null;
  };
}

export interface SectionPanelRegionProps {
  panel: SectionPanelState;
  maximized: boolean;
  chromeVisible: boolean;
  chromeSurface: ChromeSurface;
  /**
   * Skips mounting the tab content entirely. For shells that render this panel twice (docked +
   * maximized overlay), exactly one instance shows content, so terminal instances never run twice.
   */
  contentHidden?: boolean;
  ChromePortal?: React.ComponentType<PanelChromePortalProps>;
  chromeSpacerClassName?: string;
  contentStyle?: React.CSSProperties;
  /** Static content for the non-terminal sections. */
  sectionContent: Partial<Record<Exclude<PanelSection, 'terminal'>, React.ReactNode>>;
  /**
   * External-content mode for the Terminal section: the region renders only an empty content box
   * and reports it here; the host portals the terminal tab stack into it, so PTY instances survive
   * moving between panel instances (docked ↔ maximized) instead of remounting with each one.
   */
  terminalContentTargetRef: (element: HTMLDivElement | null) => void;
  onSelectSection: (section: PanelSection) => void;
  onSelectTerminalTab: (id: string) => void;
  onCloseTerminalTab: (id: string) => void;
  onAddTerminalTab: () => void;
  onToggleMax: () => void;
}

/**
 * The right panel: a fixed Diff/Terminal/Browser/Files section strip, chrome-integrated exactly like
 * the old right panel's tabs. The Terminal section additionally owns its own sub-tab strip for PTY
 * instances; the strip itself is stateless chrome rendered locally, but the PTY stack behind it is
 * owned by the host (see `terminalContentTargetRef`) so a running shell survives navigating to Diff
 * and back, and surviving the docked ↔ maximized handoff.
 */
export function SectionPanelRegion({
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  contentHidden,
  ChromePortal,
  chromeSpacerClassName,
  contentStyle,
  sectionContent,
  terminalContentTargetRef,
  onSelectSection,
  onSelectTerminalTab,
  onCloseTerminalTab,
  onAddTerminalTab,
  onToggleMax,
}: SectionPanelRegionProps): React.ReactNode {
  const chromePlacement = getPanelChromePlacement('right', chromeSurface);
  const activeIsTerminal = panel.activeSection === 'terminal';

  const content = contentHidden ? null : (
    <div className="flex h-full min-h-0 flex-col" style={contentStyle}>
      {activeIsTerminal && (
        <SectionTerminalTabStrip
          tabs={panel.terminal.tabs}
          activeTabId={panel.terminal.activeTabId}
          onSelectTab={onSelectTerminalTab}
          onCloseTab={onCloseTerminalTab}
          onAddTab={onAddTerminalTab}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={terminalContentTargetRef} className="absolute inset-0" />
        {panel.activeSection !== 'terminal' && (
          <div className="absolute inset-0">{sectionContent[panel.activeSection]}</div>
        )}
      </div>
    </div>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      {chromePlacement && chromeVisible && (
        <>
          <PanelContextualChromePortal
            ChromePortal={ChromePortal}
            segment={chromePlacement.segment}
            position={chromePlacement.tabsPosition}
            order={chromePlacement.order}
            motionAxis={chromePlacement.motionAxis}
            className="max-w-[min(560px,100%)]"
            visible={panel.open}
          >
            <SectionTabStrip
              activeSection={panel.activeSection}
              onSelectSection={onSelectSection}
            />
          </PanelContextualChromePortal>
          <PanelContextualChromePortal
            ChromePortal={ChromePortal}
            segment={chromePlacement.segment}
            position={chromePlacement.controlsPosition}
            order={chromePlacement.order + 1}
            motionAxis={chromePlacement.motionAxis}
            visible={panel.open}
          >
            <PanelContextualControls maximized={maximized} onToggleMax={onToggleMax} />
          </PanelContextualChromePortal>
        </>
      )}
      {chromeSpacerClassName && <div aria-hidden className={`${chromeSpacerClassName} shrink-0`} />}
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </section>
  );
}

function SectionTabStrip({
  activeSection,
  onSelectSection,
}: {
  activeSection: PanelSection;
  onSelectSection: (section: PanelSection) => void;
}): React.ReactNode {
  const tWindow = useTranslations('workbench.panel.window');

  return (
    <div className="flex h-full min-w-0 items-center gap-1">
      {PANEL_SECTIONS.map((section) => (
        <button
          key={section}
          type="button"
          aria-pressed={section === activeSection}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring',
            section === activeSection ? PANEL_TAB_ACTIVE_CLASSNAME : PANEL_TAB_INACTIVE_CLASSNAME,
          )}
          onClick={() => onSelectSection(section)}
        >
          <span className="shrink-0 [&_svg]:size-3.5">{PANEL_WINDOW_ICONS[section]}</span>
          <span>{tWindow(section)}</span>
        </button>
      ))}
    </div>
  );
}
