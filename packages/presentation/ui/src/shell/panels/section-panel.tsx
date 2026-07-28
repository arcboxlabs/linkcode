import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';
import type { ChromeSurface, PanelChromePortalProps } from './chrome-portal';
import { getPanelChromePlacement, PanelContextualChromePortal } from './chrome-portal';
import { PanelContextualControls } from './panel-controls';
import { PanelTabCloseButton } from './panel-tab-close-button';
import { SectionTerminalTabStrip } from './section-terminal-tabs';
import type { OptionalPanelSection, PanelSection, PanelSectionTab } from './vocabulary';
import {
  OPTIONAL_PANEL_SECTIONS,
  PANEL_SECTIONS,
  PANEL_TAB_ACTIVE_CLASSNAME,
  PANEL_TAB_INACTIVE_CLASSNAME,
  PANEL_WINDOW_ICONS,
} from './vocabulary';

export interface SectionPanelState {
  open: boolean;
  activeSection: PanelSection;
  /** The on-demand Simulator section is currently present in the strip. */
  simulatorAdded: boolean;
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
  /** Skips mounting the tab content entirely: shells rendering this panel twice (docked +
   * maximized overlay) show content in exactly one instance, so terminals never run twice. */
  contentHidden?: boolean;
  ChromePortal?: React.ComponentType<PanelChromePortalProps>;
  chromeSpacerClassName?: string;
  contentStyle?: React.CSSProperties;
  /** Static content for the non-terminal sections. */
  sectionContent: Partial<Record<Exclude<PanelSection, 'terminal'>, React.ReactNode>>;
  /** External-content mode for the Terminal section: the region renders only an empty box the
   * host portals the terminal tab stack into, so PTY instances survive docked ↔ maximized moves. */
  terminalContentTargetRef: (element: HTMLDivElement | null) => void;
  onSelectSection: (section: PanelSection) => void;
  /** Adds an on-demand section from the strip's + menu and brings it forward. */
  onAddSection: (section: OptionalPanelSection) => void;
  /** Removes an on-demand section from the strip. */
  onCloseSection: (section: OptionalPanelSection) => void;
  onSelectTerminalTab: (id: string) => void;
  onCloseTerminalTab: (id: string) => void;
  onAddTerminalTab: () => void;
  onToggleMax: () => void;
}

/** The right panel: fixed Diff/Terminal/Browser/Files section strip. The Terminal sub-tab strip
 * is stateless local chrome; the PTY stack behind it is host-owned (`terminalContentTargetRef`)
 * so a running shell survives section switches and the docked ↔ maximized handoff. */
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
  onAddSection,
  onCloseSection,
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
        {/* Sections without inline content (e.g. Browser, whose webview lives in the shell's
            resident stack behind this overlay) must not paint a click-blocking layer. */}
        {panel.activeSection !== 'terminal' &&
          sectionContent[panel.activeSection] !== undefined && (
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
              simulatorAdded={panel.simulatorAdded}
              onSelectSection={onSelectSection}
              onAddSection={onAddSection}
              onCloseSection={onCloseSection}
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
      {/* border-t: the divider between the window chrome above and every section's content. */}
      <div className="min-h-0 flex-1 overflow-hidden border-border border-t">{content}</div>
    </section>
  );
}

function SectionTabStrip({
  activeSection,
  simulatorAdded,
  onSelectSection,
  onAddSection,
  onCloseSection,
}: {
  activeSection: PanelSection;
  simulatorAdded: boolean;
  onSelectSection: (section: PanelSection) => void;
  onAddSection: (section: OptionalPanelSection) => void;
  onCloseSection: (section: OptionalPanelSection) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const tWindow = useTranslations('workbench.panel.window');
  const added: readonly OptionalPanelSection[] = simulatorAdded ? OPTIONAL_PANEL_SECTIONS : [];
  const addable = OPTIONAL_PANEL_SECTIONS.filter((section) => !added.includes(section));

  return (
    <div className="flex h-full min-w-0 items-center gap-1">
      {PANEL_SECTIONS.map((section) => {
        const label = tWindow(section);
        return (
          <button
            key={section}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={section === activeSection}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring',
              section === activeSection ? PANEL_TAB_ACTIVE_CLASSNAME : PANEL_TAB_INACTIVE_CLASSNAME,
            )}
            onClick={() => onSelectSection(section)}
          >
            <span className="shrink-0 [&_svg]:size-3.5">{PANEL_WINDOW_ICONS[section]}</span>
            {/* Collapse to icon-only when the host chrome segment is too narrow to fit
                labels without overlapping the panel's maximize control. */}
            <span className="@max-[480px]/chrome-segment:hidden">{label}</span>
          </button>
        );
      })}
      {added.map((section) => {
        const label = tWindow(section);
        return (
          <div
            key={section}
            className={cn(
              'group flex h-6 shrink-0 items-center overflow-hidden rounded-md border text-xs [-webkit-app-region:no-drag]',
              section === activeSection ? PANEL_TAB_ACTIVE_CLASSNAME : PANEL_TAB_INACTIVE_CLASSNAME,
            )}
          >
            <button
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={section === activeSection}
              className="flex h-full min-w-0 items-center gap-1.5 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelectSection(section)}
            >
              <span className="shrink-0 [&_svg]:size-3.5">{PANEL_WINDOW_ICONS[section]}</span>
              <span className="@max-[480px]/chrome-segment:hidden">{label}</span>
            </button>
            <PanelTabCloseButton
              label={t('closeTab', { label })}
              onClick={() => onCloseSection(section)}
            />
          </div>
        );
      })}
      {addable.length > 0 && (
        <Menu>
          <MenuTrigger
            render={
              <ShellIconButton label={t('openWindow')}>
                <PlusIcon />
              </ShellIconButton>
            }
          />
          <MenuPopup align="end" className="w-64" side="bottom">
            <MenuGroup>
              <MenuGroupLabel>{t('openWindow')}</MenuGroupLabel>
              {addable.map((section) => (
                <MenuItem key={section} onClick={() => onAddSection(section)}>
                  <span className="[&_svg]:size-4">{PANEL_WINDOW_ICONS[section]}</span>
                  <span>{tWindow(section)}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}
