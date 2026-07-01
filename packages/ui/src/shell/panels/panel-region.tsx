import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/cn';
import type { PanelControl, PanelTab, PanelWindowType } from '../free-panel';
import { FreePanel, PanelStubContent, PanelTabStrip } from '../free-panel';
import { PanelControlButton } from '../shell-control';

export type PanelSide = 'right' | 'bottom';
export type ChromeSurface = 'normal' | 'right-max' | 'bottom-max';

export interface PanelStateLike {
  open: boolean;
  tabs: PanelTab[];
  activeTabId: string | null;
}

export type PanelChromeSegment = 'main' | 'right';
export type PanelChromePosition = 'left' | 'right';

type ChromeMotionAxis = 'x' | 'y';

export interface PanelChromePortalProps {
  segment: PanelChromeSegment;
  position: PanelChromePosition;
  order: number;
  className?: string;
  children: React.ReactNode;
}

interface PanelChromePlacement {
  segment: PanelChromeSegment;
  tabsPosition: PanelChromePosition;
  controlsPosition: PanelChromePosition;
  order: number;
  motionAxis: ChromeMotionAxis;
}

const DESKTOP_PANEL_STRIP_CLASS =
  'h-(--lc-chrome-h) border-border border-b-0 bg-background/95 px-(--lc-chrome-edge)';
const PANEL_CHROME_TRANSITION = {
  duration: 0.18,
  ease: [0.2, 0, 0, 1] as [number, number, number, number],
};
// Inactive tabs keep their layout box (so restty's ResizeObserver never sees a 0×0 container) but
// paint nothing — cheaper and safer than display:none, which would churn the PTY size on every switch.
const HIDDEN_TAB_STYLE: React.CSSProperties = { visibility: 'hidden' };

export function PanelRegion({
  side,
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  ChromePortal,
  chromeSpacerClassName,
  contentStyle,
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
  ChromePortal?: React.ComponentType<PanelChromePortalProps>;
  chromeSpacerClassName?: string;
  contentStyle?: React.CSSProperties;
  panelContentByType?: Partial<Record<PanelWindowType, () => React.ReactNode>>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
  onToggleMax: () => void;
  onClose: () => void;
}): React.ReactNode {
  const chromePlacement = getPanelChromePlacement(side, chromeSurface);
  // Render every tab and toggle visibility instead of resolving a single node by type: two tabs of
  // the same type (e.g. two terminals) each keep their own mounted instance and live session, so
  // switching actually swaps what's shown.
  const content = (
    <div className="relative h-full min-h-0" style={contentStyle}>
      {panel.tabs.map((tab) => {
        const active = tab.id === panel.activeTabId;
        return (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={active ? undefined : HIDDEN_TAB_STYLE}
            aria-hidden={!active}
            inert={!active}
          >
            {panelContentByType?.[tab.type]?.() ?? <PanelStubContent type={tab.type} />}
          </div>
        );
      })}
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
      label: 'Fullscreen',
      icon: <Maximize2Icon />,
      active: false,
      onClick: onToggleMax,
    },
    { id: 'close', label: 'Close panel', icon: <XIcon />, onClick: onClose },
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

function PanelContextualChromePortal({
  ChromePortal,
  segment,
  position,
  order,
  motionAxis,
  className,
  visible,
  children,
}: {
  ChromePortal?: React.ComponentType<PanelChromePortalProps>;
  segment: PanelChromeSegment;
  position: PanelChromePosition;
  order: number;
  motionAxis: ChromeMotionAxis;
  className?: string;
  visible: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const reducedMotion = useReducedMotion() ?? false;
  if (ChromePortal) {
    const hiddenMotion = getPanelChromeHiddenMotion(motionAxis);
    const visibleMotion = getPanelChromeVisibleMotion(motionAxis);

    return (
      <ChromePortal
        segment={segment}
        position={position}
        order={order}
        className={cn('min-w-0', className)}
      >
        <AnimatePresence initial={false}>
          {visible && (
            <motion.div
              key="panel-contextual-chrome"
              className="flex h-full min-w-0 items-center"
              initial={reducedMotion ? false : hiddenMotion}
              animate={reducedMotion ? { opacity: 1 } : visibleMotion}
              exit={reducedMotion ? { opacity: 0 } : hiddenMotion}
              transition={{
                duration: reducedMotion ? 0 : PANEL_CHROME_TRANSITION.duration,
                ease: PANEL_CHROME_TRANSITION.ease,
              }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </ChromePortal>
    );
  }

  return null;
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

function PanelContextualControls({
  maximized,
  onToggleMax,
}: {
  maximized: boolean;
  onToggleMax: () => void;
}): React.ReactNode {
  const controls: PanelControl[] = [
    {
      id: 'max',
      label: maximized ? 'Restore' : 'Fullscreen',
      icon: maximized ? <Minimize2Icon /> : <Maximize2Icon />,
      active: maximized,
      onClick: onToggleMax,
    },
  ];

  return (
    <div className="flex h-full shrink-0 items-center gap-1">
      {controls.map((control) => (
        <PanelControlButton
          key={control.id}
          label={control.label}
          active={control.active}
          data-pressed={control.active ? '' : undefined}
          className={
            control.active
              ? 'bg-info/10 text-info-foreground hover:bg-info/15 hover:text-info-foreground'
              : undefined
          }
          onClick={control.onClick}
        >
          {control.icon}
        </PanelControlButton>
      ))}
    </div>
  );
}

function getPanelChromePlacement(
  side: PanelSide,
  chromeSurface: ChromeSurface,
): PanelChromePlacement | null {
  if (side === 'right') {
    if (chromeSurface === 'normal') {
      return {
        segment: 'right',
        tabsPosition: 'left',
        controlsPosition: 'right',
        order: 10,
        motionAxis: 'x',
      };
    }
    if (chromeSurface === 'right-max') {
      return {
        segment: 'main',
        tabsPosition: 'left',
        controlsPosition: 'right',
        order: 10,
        motionAxis: 'x',
      };
    }
    return null;
  }

  if (chromeSurface === 'bottom-max') {
    return {
      segment: 'main',
      tabsPosition: 'left',
      controlsPosition: 'right',
      order: 20,
      motionAxis: 'y',
    };
  }
  return null;
}

function getPanelChromeHiddenMotion(axis: ChromeMotionAxis): {
  opacity: number;
  x?: number;
  y?: number;
} {
  return axis === 'x' ? { opacity: 0, x: 8 } : { opacity: 0, y: 8 };
}

function getPanelChromeVisibleMotion(axis: ChromeMotionAxis): {
  opacity: number;
  x?: number;
  y?: number;
} {
  return axis === 'x' ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 };
}
