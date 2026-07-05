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
import { createContext, use, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChromeRailInsets } from './use-chrome-rail-insets';

type DesktopPanelSide = 'right' | 'bottom';

type DesktopChromeDivider = 'sidebar-main' | 'main-right';

export interface DesktopChromeProps {
  header: WorkbenchShellHeader;
  children: React.ReactNode;
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
  /** Pre-formatted shortcut hints for the default sidebar/panel toggles (e.g. "⌘J"). */
  sidebarShortcut?: string;
  rightPanelShortcut?: string;
  bottomPanelShortcut?: string;
  /** Override the stable left-rail controls (sidebar toggle + history); `null` hides them. */
  leftControls?: React.ReactNode;
  /** Override the stable right-rail controls (panel toggles); `null` hides them. */
  rightControls?: React.ReactNode;
  /** Override the main segment's default document-title area; `null` hides it. */
  titleContent?: React.ReactNode;
  /** Replaces the default document icon in the main title area. */
  titleIcon?: React.ReactNode;
  /** Rendered beside the default title (ignored when `titleContent` overrides the whole area). */
  titleChip?: React.ReactNode;
}

export type DesktopChromeSegment = 'sidebar' | 'main' | 'right';
export type DesktopChromePosition = 'left' | 'center' | 'right';

export interface DesktopChromePortalProps {
  segment: DesktopChromeSegment;
  position: DesktopChromePosition;
  order?: number;
  className?: string;
  children: React.ReactNode;
}

type DesktopChromeSlotKey = `${DesktopChromeSegment}:${DesktopChromePosition}`;
type ChromePortalTargetMap = Partial<Record<DesktopChromeSlotKey, HTMLElement>>;
type SetChromePortalTarget = (key: DesktopChromeSlotKey, target: HTMLElement | null) => void;
type ChromeBackgroundGridStyle = React.CSSProperties & {
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
} satisfies React.CSSProperties;

const MAIN_SLOT_INSET_STYLE = {
  paddingLeft:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-left-local-inset) - var(--lc-sidebar-w)))',
  paddingRight:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-right-local-inset) - var(--lc-chrome-right-segment-w)))',
} satisfies React.CSSProperties;

const RIGHT_SLOT_INSET_STYLE = {
  paddingLeft: 'var(--lc-chrome-edge)',
  paddingRight: 'var(--lc-chrome-right-local-inset)',
} satisfies React.CSSProperties;

const ACTIVE_CHROME_BUTTON_CLASS =
  'bg-info/10 text-info-foreground hover:bg-info/15 hover:text-info-foreground';

export function DesktopChromePortal({
  segment,
  position,
  order = 0,
  className,
  children,
}: DesktopChromePortalProps): React.ReactNode {
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
  sidebarShortcut,
  rightPanelShortcut,
  bottomPanelShortcut,
  leftControls,
  rightControls,
  titleContent,
  titleIcon,
  titleChip,
}: DesktopChromeProps): React.ReactNode {
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
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-(--lc-chrome-h) text-foreground [-webkit-app-region:drag]"
      >
        <ChromeSegmentGrid
          header={header}
          activeExpandedPanel={activeExpandedPanel}
          hasNativeBackdrop={hasNativeBackdrop}
          titleContent={titleContent}
          titleIcon={titleIcon}
          titleChip={titleChip}
          setPortalTarget={setPortalTarget}
        />
        <StableLeftChrome
          contentRef={leftRailContentRef}
          hasNativeTrafficLights={hasNativeTrafficLights}
        >
          {leftControls === undefined ? (
            <DefaultLeftChromeControls
              sidebarOpen={sidebarOpen}
              sidebarShortcut={sidebarShortcut}
              onShowSidebar={onShowSidebar}
              onHideSidebar={onHideSidebar}
            />
          ) : (
            leftControls
          )}
        </StableLeftChrome>
        <StableRightChrome contentRef={rightRailContentRef}>
          {rightControls === undefined ? (
            <DefaultRightChromeControls
              rightPanelOpen={rightPanelOpen}
              bottomPanelOpen={bottomPanelOpen}
              rightPanelShortcut={rightPanelShortcut}
              bottomPanelShortcut={bottomPanelShortcut}
              onToggleRight={onToggleRight}
              onToggleBottom={onToggleBottom}
            />
          ) : (
            rightControls
          )}
        </StableRightChrome>
      </div>
      {children}
    </ChromePortalTargetContext>
  );
}

function ChromeSegmentGrid({
  header,
  activeExpandedPanel,
  hasNativeBackdrop,
  titleContent,
  titleIcon,
  titleChip,
  setPortalTarget,
}: {
  header: WorkbenchShellHeader;
  activeExpandedPanel: DesktopPanelSide | null;
  hasNativeBackdrop: boolean;
  titleContent?: React.ReactNode;
  titleIcon?: React.ReactNode;
  titleChip?: React.ReactNode;
  setPortalTarget: SetChromePortalTarget;
}): React.ReactNode {
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
          left: activeExpandedPanel ? null : titleContent === undefined ? (
            <MainChromeTitle header={header} icon={titleIcon} chip={titleChip} />
          ) : (
            titleContent
          ),
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
  slotInsetStyle: React.CSSProperties;
  defaultSlots?: Partial<Record<DesktopChromePosition, React.ReactNode>>;
  setPortalTarget: SetChromePortalTarget;
}): React.ReactNode {
  return (
    <div
      className={cn('relative min-w-0 overflow-hidden backdrop-blur-xl', className)}
      data-chrome-divider={divider}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-(--lc-chrome-section-gap)',
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
  children?: React.ReactNode;
}): React.ReactNode {
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
        'flex h-full min-w-0 max-w-full items-center gap-(--lc-chrome-section-gap) overflow-hidden empty:hidden',
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
  hasNativeTrafficLights,
  children,
}: {
  contentRef: React.Ref<HTMLDivElement>;
  hasNativeTrafficLights: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="pointer-events-none absolute top-0 left-0 flex h-full items-center px-(--lc-chrome-edge)">
      <div
        ref={contentRef}
        className="pointer-events-none flex h-full items-center gap-(--lc-chrome-control-gap)"
      >
        {hasNativeTrafficLights ? <NativeTrafficLightInset /> : null}
        {children}
      </div>
    </div>
  );
}

function DefaultLeftChromeControls({
  sidebarOpen,
  sidebarShortcut,
  onShowSidebar,
  onHideSidebar,
}: {
  sidebarOpen: boolean;
  sidebarShortcut?: string;
  onShowSidebar: () => void;
  onHideSidebar: () => void;
}): React.ReactNode {
  return (
    <>
      <ShellIconButton
        label="Toggle sidebar"
        shortcut={sidebarShortcut}
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
    </>
  );
}

function MainChromeTitle({
  header,
  icon,
  chip,
}: {
  header: WorkbenchShellHeader;
  icon?: React.ReactNode;
  chip?: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="pointer-events-none flex h-full max-w-[min(420px,100%)] min-w-0 px-2 items-center gap-(--lc-chrome-control-gap)">
      <span className="mr-1 flex shrink-0 items-center">
        {icon ?? <FileTextIcon className="size-4 text-foreground" />}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-sm">{header.title}</span>
      {chip}
      <ShellIconButton label="More" disabled>
        <EllipsisIcon className="size-4" />
      </ShellIconButton>
    </div>
  );
}

function StableRightChrome({
  contentRef,
  children,
}: {
  contentRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="pointer-events-none absolute top-0 right-0 flex h-full items-center justify-end px-(--lc-chrome-edge)">
      <div
        ref={contentRef}
        className="pointer-events-none flex h-full items-center gap-(--lc-chrome-control-gap)"
      >
        {children}
      </div>
    </div>
  );
}

function DefaultRightChromeControls({
  rightPanelOpen,
  bottomPanelOpen,
  rightPanelShortcut,
  bottomPanelShortcut,
  onToggleRight,
  onToggleBottom,
}: {
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  rightPanelShortcut?: string;
  bottomPanelShortcut?: string;
  onToggleRight: () => void;
  onToggleBottom: () => void;
}): React.ReactNode {
  return (
    <>
      <ShellIconButton
        label="Toggle bottom panel"
        shortcut={bottomPanelShortcut}
        aria-pressed={bottomPanelOpen}
        className={bottomPanelOpen ? ACTIVE_CHROME_BUTTON_CLASS : undefined}
        data-pressed={bottomPanelOpen ? '' : undefined}
        onClick={onToggleBottom}
      >
        <PanelBottomIcon className="size-4" />
      </ShellIconButton>
      <ShellIconButton
        label="Toggle side panel"
        shortcut={rightPanelShortcut}
        aria-pressed={rightPanelOpen}
        className={rightPanelOpen ? ACTIVE_CHROME_BUTTON_CLASS : undefined}
        data-pressed={rightPanelOpen ? '' : undefined}
        onClick={onToggleRight}
      >
        <PanelRightIcon className="size-4" />
      </ShellIconButton>
    </>
  );
}

function NativeTrafficLightInset(): React.ReactNode {
  return <div aria-hidden className="w-(--lc-chrome-traffic-inset) shrink-0" />;
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
