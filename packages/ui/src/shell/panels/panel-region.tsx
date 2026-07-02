import { Maximize2Icon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { ChromeSurface, PanelChromePortalProps } from './chrome-portal';
import { getPanelChromePlacement, PanelContextualChromePortal } from './chrome-portal';
import { FreePanel, PanelStubContent } from './free-panel';
import { PanelTabContentStack } from './panel-content-stack';
import { PanelContextualControls } from './panel-controls';
import { PanelTabStrip } from './tab-strip';
import type { PanelControl, PanelSide, PanelTab, PanelWindowType } from './vocabulary';

export type { ChromeSurface } from './chrome-portal';

export interface PanelStateLike {
  open: boolean;
  tabs: PanelTab[];
  activeTabId: string | null;
}

const DESKTOP_PANEL_STRIP_CLASS =
  'h-(--lc-chrome-h) border-border border-b-0 bg-background/95 px-(--lc-chrome-edge)';

export function PanelRegion({
  side,
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  contentHidden,
  ChromePortal,
  chromeSpacerClassName,
  contentStyle,
  contentTargetRef,
  panelContentByType,
  onSelectTab,
  onCloseTab,
  onAddWindow,
  onToggleMax,
  onClose,
}: {
  side: PanelSide;
  panel: PanelStateLike;
  maximized: boolean;
  chromeVisible: boolean;
  chromeSurface: ChromeSurface;
  /**
   * Skips mounting the tab content entirely. For shells that render a panel twice
   * (docked + maximized overlay), exactly one instance shows content, so stateful
   * tabs like the terminal never run in duplicate.
   */
  contentHidden?: boolean;
  ChromePortal?: React.ComponentType<PanelChromePortalProps>;
  chromeSpacerClassName?: string;
  contentStyle?: React.CSSProperties;
  /**
   * External-content mode: the region renders only an empty content box and reports it here; the
   * host portals a {@link PanelTabContentStack} into it. Content then survives moving between
   * panel instances (docked ↔ maximized) instead of remounting with each one. Wins over
   * `panelContentByType`.
   */
  contentTargetRef?: (element: HTMLDivElement | null) => void;
  panelContentByType?: Partial<Record<PanelWindowType, (tab: PanelTab) => React.ReactNode>>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
  onToggleMax: () => void;
  onClose: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const chromePlacement = getPanelChromePlacement(side, chromeSurface);
  const content = contentHidden ? null : (
    <div ref={contentTargetRef} className="relative h-full min-h-0" style={contentStyle}>
      {contentTargetRef === undefined && (
        <PanelTabContentStack
          items={panel.tabs.map((tab) => ({
            id: tab.id,
            active: tab.id === panel.activeTabId,
            node: panelContentByType?.[tab.type]?.(tab) ?? <PanelStubContent type={tab.type} />,
          }))}
        />
      )}
    </div>
  );

  // Right panel and any maximized panel render chrome-integrated tabs/controls;
  // the docked bottom panel uses its own in-panel strip.
  if (side === 'right' || maximized) {
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
              <PanelContextualTabs
                panel={panel}
                onSelectTab={onSelectTab}
                onCloseTab={onCloseTab}
                onAddWindow={onAddWindow}
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
        {chromeSpacerClassName && (
          <div aria-hidden className={`${chromeSpacerClassName} shrink-0`} />
        )}
        <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
      </section>
    );
  }

  const controls: PanelControl[] = [
    {
      id: 'max',
      label: t('fullscreen'),
      icon: <Maximize2Icon />,
      active: false,
      onClick: onToggleMax,
    },
    { id: 'close', label: t('closePanel'), icon: <XIcon />, onClick: onClose },
  ];

  return (
    <FreePanel
      tabs={panel.tabs}
      activeTabId={panel.activeTabId}
      controls={controls}
      className="h-full"
      stripClassName={DESKTOP_PANEL_STRIP_CLASS}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onAddWindow={onAddWindow}
    >
      {content}
    </FreePanel>
  );
}

function PanelContextualTabs({
  panel,
  onSelectTab,
  onCloseTab,
  onAddWindow,
}: {
  panel: PanelStateLike;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
}): React.ReactNode {
  return (
    <PanelTabStrip
      tabs={panel.tabs}
      activeTabId={panel.activeTabId}
      className="h-full min-w-0 max-w-full border-0 bg-transparent px-0"
      controlsClassName="hidden"
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onAddWindow={onAddWindow}
    />
  );
}
