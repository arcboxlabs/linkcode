import { cn } from '@linkcode/ui';
import type { LayoutState, PanelSide } from '@renderer/shell/store/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  getExpandedPanelForTarget,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
} from '@renderer/shell/store/model';
import type { PaneTransition } from './pane-transition';
import { Sash } from './sash';

/** One dockable side of the workspace: its transition plus the docked and maximized-overlay nodes. */
export interface WorkspaceSide {
  transition: PaneTransition;
  open: boolean;
  node: React.ReactNode;
  expandedNode: React.ReactNode;
  onResetSize: () => void;
}

/** The sidebar: like a side, but it has no maximized-overlay form. */
export type WorkspaceSidebar = Omit<WorkspaceSide, 'expandedNode'>;

const CELL_CLASS = 'relative min-h-0 min-w-0 overflow-hidden';

/**
 * The shell workspace: one CSS grid whose tracks read the `--lc-*` shell variables
 * (index.css `.linkcode-shell-grid`). Pane toggles write a variable once and a scoped
 * grid-template transition glides every edge on the same 300ms timeline as the titlebar
 * chrome; sash drags write the same variable per frame with the transition inactive.
 * While a pane animates, its content is locked to the settled size so nothing rewraps
 * per frame — only grid tracks move.
 */
export function DesktopWorkspace({
  sidebar,
  main,
  right,
  bottom,
  expandedPanel,
  layout,
  onLayoutChange,
  onSidebarResize,
  onRightResize,
  onBottomResize,
}: {
  sidebar: WorkspaceSidebar;
  main: React.ReactNode;
  right: WorkspaceSide;
  bottom: WorkspaceSide;
  expandedPanel: PanelSide | null;
  layout: LayoutState;
  onLayoutChange: (updater: (current: LayoutState) => LayoutState) => void;
  /** Imperative shell-variable writers (the same ones the pane transitions use). */
  onSidebarResize: (size: number) => void;
  onRightResize: (size: number) => void;
  onBottomResize: (size: number) => void;
}): React.ReactNode {
  const rowOverlayPanel = getExpandedPanelForTarget(expandedPanel, 'editor-row');
  const workbenchOverlayPanel = getExpandedPanelForTarget(expandedPanel, 'workbench');
  // Expanded panels render as direct overlays. Docked panels stay mounted so
  // they keep owning chrome portals and panel state.
  const dockedInert = workbenchOverlayPanel !== null;
  const editorInert = rowOverlayPanel !== null || dockedInert;

  const anyAnimating =
    sidebar.transition.isAnimating || right.transition.isAnimating || bottom.transition.isAnimating;
  const horizontalAnimating = sidebar.transition.isAnimating || right.transition.isAnimating;

  return (
    <div className="linkcode-shell-workspace isolate h-full min-h-0 min-w-0">
      <div className="linkcode-shell-grid h-full w-full">
        {/* The sidebar cell's right edge is the animated divider, so the cell owns the
            border (the aside's own border-r is suppressed by the shell). */}
        <div
          data-shell-pane="sidebar"
          aria-hidden={!sidebar.open}
          inert={!sidebar.open}
          className={cn(
            CELL_CLASS,
            'col-start-1 row-span-2 row-start-1',
            sidebar.transition.paneVisible && 'border-sidebar-border border-r',
          )}
        >
          <div
            className="h-full"
            style={sidebar.transition.isAnimating ? { width: layout.sidebarW } : undefined}
          >
            {sidebar.node}
          </div>
        </div>

        <div
          data-shell-pane="main"
          aria-hidden={editorInert}
          inert={editorInert}
          className={cn(CELL_CLASS, 'col-start-2 row-start-1 bg-background')}
        >
          {/* During a horizontal pane transition the main content is laid out ONCE at its
              final width and kept centered in the animating cell (index.css), so its text
              glides with the moving track edges instead of rewrapping per frame. */}
          <div className={cn('h-full', horizontalAnimating && 'linkcode-shell-main-lock')}>
            {main}
          </div>
        </div>

        <div
          data-shell-pane="right"
          aria-hidden={!right.open || editorInert}
          inert={!right.open || editorInert}
          className={cn(
            CELL_CLASS,
            'col-start-3 row-start-1',
            right.transition.paneVisible && 'border-border border-l',
          )}
        >
          <div
            className="h-full"
            style={right.transition.isAnimating ? { width: layout.rightW } : undefined}
          >
            {right.node}
          </div>
        </div>

        <div
          data-shell-pane="bottom"
          aria-hidden={!bottom.open || dockedInert}
          inert={!bottom.open || dockedInert}
          className={cn(
            CELL_CLASS,
            'col-span-2 col-start-2 row-start-2',
            bottom.transition.paneVisible && 'border-border border-t',
          )}
        >
          {/* h-full at rest; the inline lock (fixed px, overriding the percentage) wins while
              the row track animates so the panel content never resizes mid-toggle. */}
          <div
            className="h-full"
            style={bottom.transition.isAnimating ? { height: layout.bottomH } : undefined}
          >
            {bottom.node}
          </div>
        </div>

        {/* Sashes are absolute (no grid area), positioned by the same track variables. */}
        {sidebar.open && (
          <Sash
            orientation="vertical"
            edge="start"
            className="linkcode-sash-sidebar"
            size={layout.sidebarW}
            minSize={SIDEBAR_MIN_SIZE}
            maxSize={SIDEBAR_MAX_SIZE}
            disabled={anyAnimating}
            onResize={onSidebarResize}
            onResizeEnd={(size) => onLayoutChange((current) => ({ ...current, sidebarW: size }))}
            onReset={sidebar.onResetSize}
          />
        )}
        {right.open && (
          <Sash
            orientation="vertical"
            edge="end"
            className="linkcode-sash-right"
            size={layout.rightW}
            minSize={RIGHT_PANEL_MIN_SIZE}
            maxSize={RIGHT_PANEL_MAX_SIZE}
            disabled={anyAnimating}
            onResize={onRightResize}
            onResizeEnd={(size) => onLayoutChange((current) => ({ ...current, rightW: size }))}
            onReset={right.onResetSize}
          />
        )}
        {bottom.open && (
          <Sash
            orientation="horizontal"
            edge="end"
            className="linkcode-sash-bottom"
            size={layout.bottomH}
            minSize={BOTTOM_PANEL_MIN_SIZE}
            maxSize={BOTTOM_PANEL_MAX_SIZE}
            disabled={anyAnimating}
            onResize={onBottomResize}
            onResizeEnd={(size) => onLayoutChange((current) => ({ ...current, bottomH: size }))}
            onReset={bottom.onResetSize}
          />
        )}

        {rowOverlayPanel && (
          <ExpandedPanelOverlay
            side={rowOverlayPanel}
            className="col-end-4 col-start-2 row-start-1"
          >
            {rowOverlayPanel === 'right' ? right.expandedNode : bottom.expandedNode}
          </ExpandedPanelOverlay>
        )}
        {workbenchOverlayPanel && (
          <ExpandedPanelOverlay
            side={workbenchOverlayPanel}
            className="col-end-4 col-start-2 row-span-2 row-start-1"
          >
            {workbenchOverlayPanel === 'right' ? right.expandedNode : bottom.expandedNode}
          </ExpandedPanelOverlay>
        )}
      </div>
    </div>
  );
}

function ExpandedPanelOverlay({
  side,
  className,
  children,
}: {
  side: PanelSide;
  className: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div
      data-expanded-panel={side}
      className={cn('z-20 min-h-0 min-w-0 overflow-hidden bg-background', className)}
    >
      {children}
    </div>
  );
}
