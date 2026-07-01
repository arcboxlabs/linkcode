import type { DesktopChromePosition, DesktopChromeSegment } from '@desktop/shell/chrome/chrome';
import { DesktopChromePortal } from '@desktop/shell/chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from '@desktop/shell/chrome/metrics';
import { SHELL_TRANSITION } from '@desktop/shell/layout/use-animated-split';
import type { PanelSide, PanelState } from '@desktop/shell/state/local/model';
import type { PanelControl, PanelWindowType } from '@linkcode/ui';
import { cn, FreePanel, PanelControlButton, PanelStubContent, PanelTabStrip } from '@linkcode/ui';
import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ChromeSurface } from './panel-layout';

type ChromeMotionAxis = 'x' | 'y';

interface PanelChromePlacement {
  segment: DesktopChromeSegment;
  tabsPosition: DesktopChromePosition;
  controlsPosition: DesktopChromePosition;
  order: number;
  motionAxis: ChromeMotionAxis;
}

const DESKTOP_PANEL_STRIP_CLASS =
  'h-(--lc-chrome-h) border-border border-b-0 bg-background/95 px-(--lc-chrome-edge)';

export function PanelRegion({
  side,
  panel,
  maximized,
  chromeVisible,
  chromeSurface,
  contentStyle,
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
  contentStyle?: React.CSSProperties;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
  onToggleMax: () => void;
  onClose: () => void;
}): React.ReactNode {
  const activeType = activePanelWindowType(panel);
  const chromePlacement = getPanelChromePlacement(side, chromeSurface);
  const content = (
    <div className="h-full min-h-0" style={contentStyle}>
      <PanelStubContent type={activeType} />
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
        <div aria-hidden className={`${DESKTOP_CHROME_SPACER_CLASS} shrink-0`} />
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

function activePanelWindowType(panel: PanelState): PanelWindowType {
  for (const tab of panel.tabs) {
    if (tab.id === panel.activeTabId) return tab.type;
  }
  return 'terminal';
}

function PanelContextualChromePortal({
  segment,
  position,
  order,
  motionAxis,
  className,
  visible,
  children,
}: {
  segment: DesktopChromeSegment;
  position: DesktopChromePosition;
  order: number;
  motionAxis: ChromeMotionAxis;
  className?: string;
  visible: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const reducedMotion = useReducedMotion() ?? false;
  const hiddenMotion = getPanelChromeHiddenMotion(motionAxis);
  const visibleMotion = getPanelChromeVisibleMotion(motionAxis);

  return (
    <DesktopChromePortal
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
              duration: reducedMotion ? 0 : SHELL_TRANSITION.duration,
              ease: SHELL_TRANSITION.ease,
            }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </DesktopChromePortal>
  );
}

function PanelContextualTabs({
  panel,
  onSelectTab,
  onCloseTab,
  onAddWindow,
}: {
  panel: PanelState;
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
