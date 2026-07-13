import { cn, ShellIconButton } from '@linkcode/ui';
import type { WorkbenchShellHeader, WorkbenchShellNavigation } from '@linkcode/workbench';
import { nullthrow } from 'foxact/nullthrow';
import { useIsomorphicLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
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
import { useTranslations } from 'use-intl';
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
  /** Draw renderer window controls (minimize/maximize/close) — non-macOS, once the platform is known. */
  showWindowControls: boolean;
  onShowSidebar: () => void;
  onHideSidebar: () => void;
  onToggleRight: () => void;
  onToggleBottom: () => void;
  /** Drives the default left-rail ‹ › controls; absent (e.g. Settings) keeps them disabled. */
  navigation?: WorkbenchShellNavigation;
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
type ChromePortalUseMap = Partial<Record<DesktopChromeSlotKey, number>>;
type RegisterChromePortalUse = (key: DesktopChromeSlotKey) => () => void;
type ChromeBackgroundGridStyle = React.CSSProperties & {
  '--lc-chrome-right-segment-w': string;
};

const ChromePortalTargetContext = createContext<ChromePortalTargetMap | null>(null);
const ChromePortalRegisterContext = createContext<RegisterChromePortalUse | null>(null);

// The columns read the window-clamped track variables (index.css) — the same ones the
// workspace grid uses — so the titlebar dividers stay glued to the real pane edges even
// when a small window forces the clamps to engage.
const CHROME_BACKGROUND_GRID_STYLE = {
  gridTemplateColumns: 'var(--lc-sidebar-col) minmax(0, 1fr) var(--lc-right-col)',
  '--lc-chrome-right-segment-w': 'var(--lc-right-col)',
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
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-left-local-inset) - var(--lc-sidebar-col)))',
  paddingRight:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-right-local-inset) - var(--lc-chrome-right-segment-w)))',
} satisfies React.CSSProperties;

const EXPANDED_MAIN_SLOT_INSET_STYLE = {
  paddingLeft:
    'max(var(--lc-chrome-edge), calc(var(--lc-chrome-left-local-inset) - var(--lc-sidebar-col)))',
  paddingRight: 'var(--lc-chrome-right-local-inset)',
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
  const registerUse = nullthrow(
    use(ChromePortalRegisterContext),
    'Desktop chrome portal registry is missing',
  );

  const slotKey = createChromeSlotKey(segment, position);
  // Portal-wins: registering suppresses the slot's default content (e.g. the settings title)
  // while this portal is mounted; layout-effect timing keeps them from double-rendering a frame.
  useIsomorphicLayoutEffect(() => registerUse(slotKey), [registerUse, slotKey]);

  const target = targets[slotKey];
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
  showWindowControls,
  onShowSidebar,
  onHideSidebar,
  onToggleRight,
  onToggleBottom,
  navigation,
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
  const [portalUse, setPortalUse] = useState<ChromePortalUseMap>({});
  const chromeRootRef = useRef<HTMLDivElement | null>(null);
  const leftRailContentRef = useRef<HTMLDivElement | null>(null);
  const rightRailContentRef = useRef<HTMLDivElement | null>(null);
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
  const registerPortalUse = useCallback<RegisterChromePortalUse>((key) => {
    setPortalUse((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
    return () => {
      setPortalUse((current) => ({ ...current, [key]: Math.max(0, (current[key] ?? 1) - 1) }));
    };
  }, []);

  return (
    <ChromePortalRegisterContext value={registerPortalUse}>
      <ChromePortalTargetContext value={portalTargets}>
        {/* Size container for the shell's cq-based track math (index.css): the chrome grid
            and the workspace grid both resolve the clamped `--lc-*-col` variables against
            this frame, so their dividers stay in lockstep at every window size. */}
        <div className="linkcode-shell-frame relative h-full">
          <div
            ref={chromeRootRef}
            className="pointer-events-none absolute inset-x-0 top-0 z-30 h-(--lc-chrome-h) text-foreground [-webkit-app-region:drag]"
          >
            <ChromeSegmentGrid
              header={header}
              expandedPanel={expandedPanel}
              hasNativeBackdrop={hasNativeBackdrop}
              titleContent={titleContent}
              titleIcon={titleIcon}
              titleChip={titleChip}
              portalUse={portalUse}
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
                  navigation={navigation}
                  onShowSidebar={onShowSidebar}
                  onHideSidebar={onHideSidebar}
                />
              ) : (
                leftControls
              )}
            </StableLeftChrome>
            <StableRightChrome
              contentRef={rightRailContentRef}
              showWindowControls={showWindowControls}
            >
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
        </div>
      </ChromePortalTargetContext>
    </ChromePortalRegisterContext>
  );
}

function ChromeSegmentGrid({
  header,
  expandedPanel,
  hasNativeBackdrop,
  titleContent,
  titleIcon,
  titleChip,
  portalUse,
  setPortalTarget,
}: {
  header: WorkbenchShellHeader;
  expandedPanel: DesktopPanelSide | null;
  hasNativeBackdrop: boolean;
  titleContent?: React.ReactNode;
  titleIcon?: React.ReactNode;
  titleChip?: React.ReactNode;
  portalUse: ChromePortalUseMap;
  setPortalTarget: SetChromePortalTarget;
}): React.ReactNode {
  return (
    <div
      className="linkcode-chrome-grid absolute inset-0 grid overflow-hidden"
      style={CHROME_BACKGROUND_GRID_STYLE}
    >
      <ChromeSegment
        segment="sidebar"
        divider="sidebar-main"
        // The sidebar owns the native-backdrop tint across its full height; keep
        // this overlay transparent so the title area does not get double-tinted.
        className={
          hasNativeBackdrop
            ? 'col-start-1 bg-transparent backdrop-blur-none'
            : 'col-start-1 border-sidebar-border border-r bg-sidebar backdrop-blur-none'
        }
        slotInsetStyle={SIDEBAR_SLOT_INSET_STYLE}
        portalUse={portalUse}
        setPortalTarget={setPortalTarget}
      />
      <ChromeSegment
        segment="main"
        className={cn('col-start-2 bg-background/80', expandedPanel && 'z-10 col-end-4')}
        slotInsetStyle={expandedPanel ? EXPANDED_MAIN_SLOT_INSET_STYLE : MAIN_SLOT_INSET_STYLE}
        // While any panel is maximized the main segment hosts that panel's tabs
        // and controls, so the document title/actions step aside entirely.
        defaultSlots={{
          left: expandedPanel ? null : titleContent === undefined ? (
            <MainChromeTitle header={header} icon={titleIcon} chip={titleChip} />
          ) : (
            titleContent
          ),
        }}
        portalUse={portalUse}
        setPortalTarget={setPortalTarget}
      />
      <ChromeSegment
        segment="right"
        divider="main-right"
        className="col-start-3 border-border border-l bg-background/80"
        hidden={expandedPanel !== null}
        slotInsetStyle={RIGHT_SLOT_INSET_STYLE}
        portalUse={portalUse}
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
  hidden = false,
  portalUse,
  setPortalTarget,
}: {
  segment: DesktopChromeSegment;
  divider?: DesktopChromeDivider;
  className: string;
  slotInsetStyle: React.CSSProperties;
  defaultSlots?: Partial<Record<DesktopChromePosition, React.ReactNode>>;
  hidden?: boolean;
  portalUse: ChromePortalUseMap;
  setPortalTarget: SetChromePortalTarget;
}): React.ReactNode {
  return (
    // Size container so portaled panel chrome (e.g. the section tab strip) can collapse
    // its labels to icons when its host segment gets narrow (`@max-*/chrome-segment`).
    <div
      className={cn(
        '@container/chrome-segment relative min-w-0 overflow-hidden backdrop-blur-xl',
        hidden && 'invisible',
        className,
      )}
      data-chrome-divider={divider}
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      <div
        className={cn(
          'linkcode-chrome-slot-inset pointer-events-none absolute inset-0 grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-(--lc-chrome-section-gap)',
        )}
        style={slotInsetStyle}
      >
        <ChromeSlotTarget
          segment={segment}
          position="left"
          portalUse={portalUse}
          setPortalTarget={setPortalTarget}
        >
          {defaultSlots?.left}
        </ChromeSlotTarget>
        <ChromeSlotTarget
          segment={segment}
          position="center"
          portalUse={portalUse}
          setPortalTarget={setPortalTarget}
        >
          {defaultSlots?.center}
        </ChromeSlotTarget>
        <ChromeSlotTarget
          segment={segment}
          position="right"
          portalUse={portalUse}
          setPortalTarget={setPortalTarget}
        >
          {defaultSlots?.right}
        </ChromeSlotTarget>
      </div>
    </div>
  );
}

function ChromeSlotTarget({
  segment,
  position,
  portalUse,
  setPortalTarget,
  children,
}: {
  segment: DesktopChromeSegment;
  position: DesktopChromePosition;
  portalUse: ChromePortalUseMap;
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

  // Portal-wins: while any DesktopChromePortal targets this slot, the default content yields
  // to it — hosts never special-case which tab supplies its own chrome.
  const suppressed = (portalUse[slotKey] ?? 0) > 0;

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
      {suppressed ? null : children}
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
  navigation,
  onShowSidebar,
  onHideSidebar,
}: {
  sidebarOpen: boolean;
  sidebarShortcut?: string;
  navigation?: WorkbenchShellNavigation;
  onShowSidebar: () => void;
  onHideSidebar: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.palette');

  return (
    <>
      <ShellIconButton
        label={t('toggleSidebar')}
        shortcut={sidebarShortcut}
        aria-pressed={sidebarOpen}
        onClick={sidebarOpen ? onHideSidebar : onShowSidebar}
      >
        <PanelLeftIcon className="size-4" />
      </ShellIconButton>
      <ShellIconButton
        label={t('goBack')}
        disabled={navigation?.canGoBack !== true}
        onClick={navigation?.onBack}
      >
        <ChevronLeftIcon className="size-4" />
      </ShellIconButton>
      <ShellIconButton
        label={t('goForward')}
        disabled={navigation?.canGoForward !== true}
        onClick={navigation?.onForward}
      >
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
  showWindowControls,
  children,
}: {
  contentRef: React.Ref<HTMLDivElement>;
  showWindowControls: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="pointer-events-none absolute top-0 right-0 flex h-full items-center justify-end px-(--lc-chrome-edge)">
      <div
        ref={contentRef}
        className="pointer-events-none flex h-full items-center gap-(--lc-chrome-control-gap)"
      >
        {children}
        {/* Reserve the space the persistent window-controls layer (DesktopWindowControls, mounted at
            the app root) floats over, so the panel toggles never sit under it. */}
        {showWindowControls ? <WindowControlsInset /> : null}
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

function WindowControlsInset(): React.ReactNode {
  return <div aria-hidden className="w-(--lc-chrome-window-controls-inset) shrink-0" />;
}

function createChromeSlotKey(
  segment: DesktopChromeSegment,
  position: DesktopChromePosition,
): DesktopChromeSlotKey {
  return `${segment}:${position}`;
}
