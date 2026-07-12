import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/cn';
import type { PanelSide } from './vocabulary';

export type ChromeSurface = 'normal' | 'right-max' | 'bottom-max';

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

const PANEL_CHROME_TRANSITION = {
  // Matches the shell pane toggle (SHELL_TRANSITION in the desktop renderer).
  duration: 0.3,
  ease: [0.2, 0, 0, 1] as [number, number, number, number],
};

/** Portals contextual panel chrome (tabs/controls) into the host chrome, animating in/out with the panel. */
export function PanelContextualChromePortal({
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

/** Where a panel's chrome-integrated tabs/controls portal to, given its side and current chrome surface. */
export function getPanelChromePlacement(
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
