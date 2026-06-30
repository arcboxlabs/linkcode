import { cn, ShellIconButton } from '@linkcode/ui';
import type { WorkbenchShellHeader } from '@linkcode/workbench';
import { nullthrow } from 'foxact/nullthrow';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FileTextIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { createContext, use, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChromeRailInsets } from './use-chrome-rail-insets';

type DesktopPanelSide = 'right' | 'bottom';

type DesktopChromeDivider = 'sidebar-main' | 'main-right';

export interface DesktopChromeProps {
  header: WorkbenchShellHeader;
  children: ReactNode;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  expandedPanel: DesktopPanelSide | null;
  hasNativeBackdrop: boolean;
  hasNativeTrafficLights: boolean;
  onShowSidebar: () => void;
  onHideSidebar: () => void;
  onToggleRight: () => void;
  onToggleBottom: () => void;
}

export type DesktopChromeSegment = 'sidebar' | 'main' | 'right';
export type DesktopChromePosition = 'left' | 'center' | 'right';

export interface DesktopChromePortalProps {
  segment: DesktopChromeSegment;
  position: DesktopChromePosition;
  order?: number;
  className?: string;
  children: ReactNode;
}

type DesktopChromeSlotKey = `${DesktopChromeSegment}:${DesktopChromePosition}`;
type ChromePortalTargetMap = Partial<Record<DesktopChromeSlotKey, HTMLElement>>;
type SetChromePortalTarget = (key: DesktopChromeSlotKey, target: HTMLElement | null) => void;
type ChromeBackgroundGridStyle = CSSProperties & {
  '--lc-chrome-right-segment-w': string;
};

const ChromePortalTargetContext = createContext<ChromePortalTargetMap | null>(null);

const CHROME_BACKGROUND_GRID_STYLE = {
  gridTemplateColumns: 'var(--lc-sidebar-w) minmax(0, 1fr) var(--lc-right-w)',
  '--lc-chrome-right-segment-w': 'var(--lc-right-w)',
} satisfies ChromeBackgroundGridStyle;

// Maximizing is a direct cut: the right segment collapses to zero instantly.
const MAXIMIZED_CHROME_BACKGROUND_GRID_STYLE = {
  gridTemplateColumns: 'var(--lc-sidebar-w) minmax(0, 1fr) 0px',
  '--lc-chrome-right-segment-w': '0px',
} satisfies ChromeBackgroundGridStyle;

const CHROME_SLOT_CLASS: Record<DesktopChromePosition, string> = {
  left: 'col-start-1 justify-start',
  center: 'col-start-2 justify-center',
  right: 'col-start-3 justify-end',
};

const SIDEBAR_SLOT_INSET_STYLE = {
  paddingLeft: 'var(--lc-chrome-left-local-inset)',
  paddingRight: 'var(--lc-chrome-edge)',
} satisfies CSSProperties;

const MAIN_SLOT_INSET_STYLE = {
  paddingLeft:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-left-local-inset) - var(--lc-sidebar-w)))',
  paddingRight:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-right-local-inset) - var(--lc-chrome-right-segment-w)))',
} satisfies CSSProperties;

const RIGHT_SLOT_INSET_STYLE = {
  paddingLeft: 'var(--lc-chrome-edge)',
  paddingRight: 'var(--lc-chrome-right-local-inset)',
} satisfies CSSProperties;

const ACTIVE_CHROME_BUTTON_CLASS =
  'bg-info/10 text-info-foreground hover:bg-info/15 hover:text-info-foreground';

export function DesktopChromePortal({
  segment,
  position,
  order = 0,
  className,
  children,
}: DesktopChromePortalProps): ReactNode {
  const targets = nullthrow(
    use(ChromePortalTargetContext),
    'Desktop chrome portal targets are missing',
  );

  const target = targets[createChromeSlotKey(segment, position)];
  if (!target) return null;

  return createPortal(
    <div
      className={cn('pointer-events-auto flex h-full min-w-0 items-center', className)}
      style={{ order }}
    >
      {children}
    </div>,
    target,
  );
}

export function DesktopChrome({
  header,
  children,
  sidebarOpen,
  rightPanelOpen,
  bottomPanelOpen,
  expandedPanel,
  hasNativeBackdrop,
  hasNativeTrafficLights,
  onShowSidebar,
  onHideSidebar,
  onToggleRight,
  onToggleBottom,
}: DesktopChromeProps): ReactNode {
  const [portalTargets, setPortalTargets] = useState<ChromePortalTargetMap>({});
  const chromeRootRef = useRef<HTMLDivElement | null>(null);
  const leftRailContentRef = useRef<HTMLDivElement | null>(null);
  const rightRailContentRef = useRef<HTMLDivElement | null>(null);
  const activeExpandedPanel = getActiveExpandedPanel({
    expandedPanel,
    rightPanelOpen,
    bottomPanelOpen,
  });
  useChromeRailInsets({ rootRef: chromeRootRef, leftRailContentRef, rightRailContentRef });
  const setPortalTarget = useCallback<SetChromePortalTarget>((key, target) => {
    setPortalTargets((current) => {
      if (target) {
        if (current[key] === target) return current;
        return { ...current, [key]: target };
      }

      if (!current[key]) return current;
      return { ...current, [key]: undefined };
    });
  }, []);

  return (
    <ChromePortalTargetContext value={portalTargets}>
      <div
        ref={chromeRootRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[var(--lc-chrome-h)] text-foreground [-webkit-app-region:drag]"
      >
        <ChromeSegmentGrid
          header={header}
          activeExpandedPanel={activeExpandedPanel}
          hasNativeBackdrop={hasNativeBackdrop}
          setPortalTarget={setPortalTarget}
        />
        <StableLeftChrome
          contentRef={leftRailContentRef}
          sidebarOpen={sidebarOpen}
          hasNativeTrafficLights={hasNativeTrafficLights}
          onShowSidebar={onShowSidebar}
          onHideSidebar={onHideSidebar}
        />
        <StableRightChrome
          contentRef={rightRailContentRef}
          rightPanelOpen={rightPanelOpen}
          bottomPanelOpen={bottomPanelOpen}
          onToggleRight={onToggleRight}
          onToggleBottom={onToggleBottom}
        />
      </div>
      {children}
    </ChromePortalTargetContext>
  );
}

function ChromeSegmentGrid({
  header,
  activeExpandedPanel,
  hasNativeBackdrop,
  setPortalTarget,
}: {
  header: WorkbenchShellHeader;
  activeExpandedPanel: DesktopPanelSide | null;
  hasNativeBackdrop: boolean;
  setPortalTarget: SetChromePortalTarget;
}): ReactNode {
  return (
    <div
      className="absolute inset-0 grid overflow-hidden"
      style={
        activeExpandedPanel ? MAXIMIZED_CHROME_BACKGROUND_GRID_STYLE : CHROME_BACKGROUND_GRID_STYLE
      }
    >
      <ChromeSegment
        segment="sidebar"
        divider="sidebar-main"
        // The sidebar owns the native-backdrop tint across its full height; keep
        // this overlay transparent so the title area does not get double-tinted.
        className={
          hasNativeBackdrop
            ? 'bg-transparent backdrop-blur-none'
            : 'border-sidebar-border border-r bg-sidebar backdrop-blur-none'
        }
        slotInsetStyle={SIDEBAR_SLOT_INSET_STYLE}
        setPortalTarget={setPortalTarget}
      />
      <ChromeSegment
        segment="main"
        className="bg-background/80"
        slotInsetStyle={MAIN_SLOT_INSET_STYLE}
        // While any panel is maximized the main segment hosts that panel's tabs
        // and controls, so the document title/actions step aside entirely.
        defaultSlots={{
          left: activeExpandedPanel ? null : <MainChromeTitle header={header} />,
        }}
        setPortalTarget={setPortalTarget}
      />
      <ChromeSegment
        segment="right"
        divider="main-right"
        className="border-border border-l bg-background/80"
        slotInsetStyle={RIGHT_SLOT_INSET_STYLE}
        setPortalTarget={setPortalTarget}
      />
    </div>
  );
}

function ChromeSegment({
  segment,
  divider,
  className,
  slotInsetStyle,
  defaultSlots,
  setPortalTarget,
}: {
  segment: DesktopChromeSegment;
  divider?: DesktopChromeDivider;
  className: string;
  slotInsetStyle: CSSProperties;
  defaultSlots?: Partial<Record<DesktopChromePosition, ReactNode>>;
  setPortalTarget: SetChromePortalTarget;
}): ReactNode {
  return (
    <div
      className={cn('relative min-w-0 overflow-hidden backdrop-blur-xl', className)}
      data-chrome-divider={divider}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-[var(--lc-chrome-section-gap)]',
        )}
        style={slotInsetStyle}
      >
        <ChromeSlotTarget segment={segment} position="left" setPortalTarget={setPortalTarget}>
          {defaultSlots?.left}
        </ChromeSlotTarget>
        <ChromeSlotTarget segment={segment} position="center" setPortalTarget={setPortalTarget}>
          {defaultSlots?.center}
        </ChromeSlotTarget>
        <ChromeSlotTarget segment={segment} position="right" setPortalTarget={setPortalTarget}>
          {defaultSlots?.right}
        </ChromeSlotTarget>
      </div>
    </div>
  );
}

function ChromeSlotTarget({
  segment,
  position,
  setPortalTarget,
  children,
}: {
  segment: DesktopChromeSegment;
  position: DesktopChromePosition;
  setPortalTarget: SetChromePortalTarget;
  children?: ReactNode;
}): ReactNode {
  const slotKey = createChromeSlotKey(segment, position);
  const setSlotElement = useCallback(
    (element: HTMLDivElement | null): void => {
      setPortalTarget(slotKey, element);
    },
    [setPortalTarget, slotKey],
  );

  return (
    <div
      ref={setSlotElement}
      className={cn(
        'flex h-full min-w-0 max-w-full items-center gap-[var(--lc-chrome-section-gap)] overflow-hidden empty:hidden',
        CHROME_SLOT_CLASS[position],
      )}
      data-chrome-segment={segment}
      data-chrome-position={position}
    >
      {children}
    </div>
  );
}

function StableLeftChrome({
  contentRef,
  sidebarOpen,
  hasNativeTrafficLights,
  onShowSidebar,
  onHideSidebar,
}: {
  contentRef: Ref<HTMLDivElement>;
  sidebarOpen: boolean;
  hasNativeTrafficLights: boolean;
  onShowSidebar: () => void;
  onHideSidebar: () => void;
}): ReactNode {
  return (
    <div className="pointer-events-none absolute top-0 left-0 flex h-full items-center px-[var(--lc-chrome-edge)]">
      <div
        ref={contentRef}
        className="pointer-events-none flex h-full items-center gap-[var(--lc-chrome-control-gap)]"
      >
        {hasNativeTrafficLights ? <NativeTrafficLightInset /> : null}
        <ShellIconButton
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={sidebarOpen}
          onClick={sidebarOpen ? onHideSidebar : onShowSidebar}
        >
          <PanelLeftIcon className="size-4" />
        </ShellIconButton>
        <ShellIconButton label="Back" disabled>
          <ChevronLeftIcon className="size-4" />
        </ShellIconButton>
        <ShellIconButton label="Forward" disabled>
          <ChevronRightIcon className="size-4" />
        </ShellIconButton>
      </div>
    </div>
  );
}

function MainChromeTitle({ header }: { header: WorkbenchShellHeader }): ReactNode {
  return (
    <div className="pointer-events-none flex h-full max-w-[min(420px,100%)] min-w-0 px-2 items-center gap-[var(--lc-chrome-control-gap)]">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-semibold text-sm">{header.title}</span>
      <ShellIconButton label="More" disabled>
        <EllipsisIcon className="size-4" />
      </ShellIconButton>
    </div>
  );
}

function StableRightChrome({
  contentRef,
  rightPanelOpen,
  bottomPanelOpen,
  onToggleRight,
  onToggleBottom,
}: {
  contentRef: Ref<HTMLDivElement>;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  onToggleRight: () => void;
  onToggleBottom: () => void;
}): ReactNode {
  return (
    <div className="pointer-events-none absolute top-0 right-0 flex h-full items-center justify-end px-[var(--lc-chrome-edge)]">
      <div
        ref={contentRef}
        className="pointer-events-none flex h-full items-center gap-[var(--lc-chrome-control-gap)]"
      >
        <ShellIconButton
          label={bottomPanelOpen ? 'Close bottom panel' : 'Open bottom panel'}
          aria-pressed={bottomPanelOpen}
          className={bottomPanelOpen ? ACTIVE_CHROME_BUTTON_CLASS : undefined}
          data-pressed={bottomPanelOpen ? '' : undefined}
          onClick={onToggleBottom}
        >
          <PanelBottomIcon className="size-4" />
        </ShellIconButton>
        <ShellIconButton
          label={rightPanelOpen ? 'Close right panel' : 'Open right panel'}
          aria-pressed={rightPanelOpen}
          className={rightPanelOpen ? ACTIVE_CHROME_BUTTON_CLASS : undefined}
          data-pressed={rightPanelOpen ? '' : undefined}
          onClick={onToggleRight}
        >
          <PanelRightIcon className="size-4" />
        </ShellIconButton>
      </div>
    </div>
  );
}

function NativeTrafficLightInset(): ReactNode {
  return <div aria-hidden className="w-[var(--lc-chrome-traffic-inset)] shrink-0" />;
}

function getActiveExpandedPanel({
  expandedPanel,
  rightPanelOpen,
  bottomPanelOpen,
}: {
  expandedPanel: DesktopPanelSide | null;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
}): DesktopPanelSide | null {
  if (expandedPanel === 'right' && rightPanelOpen) return 'right';
  if (expandedPanel === 'bottom' && bottomPanelOpen) return 'bottom';
  return null;
}

function createChromeSlotKey(
  segment: DesktopChromeSegment,
  position: DesktopChromePosition,
): DesktopChromeSlotKey {
  return `${segment}:${position}`;
}
