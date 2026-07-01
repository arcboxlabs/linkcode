import type { LayoutState, PanelSide } from '@renderer/shell/store/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  getExpandedPanelForTarget,
  MIN_MAIN_SIZE,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  readPaneSize,
} from '@renderer/shell/store/model';
import type { AllotmentHandle } from 'allotment';
import { Allotment, LayoutPriority } from 'allotment';
import type { AnimatedSplit } from './use-animated-split';

/** One dockable side of the workspace: its animated split plus the docked and maximized-overlay nodes. */
export interface WorkspaceSide {
  split: Omit<AnimatedSplit, 'setAllotmentHandle'>;
  open: boolean;
  node: React.ReactNode;
  expandedNode: React.ReactNode;
  onResetSize: () => void;
}

export function DesktopWorkspace({
  main,
  right,
  bottom,
  // The allotment ref setters arrive as standalone props: the React Compiler only
  // accepts a plain identifier in `ref={…}`, so they cannot live on the side objects.
  rightAllotmentRef,
  bottomAllotmentRef,
  expandedPanel,
  layout,
  onLayoutChange,
}: {
  main: React.ReactNode;
  right: WorkspaceSide;
  bottom: WorkspaceSide;
  rightAllotmentRef: (handle: AllotmentHandle | null) => void;
  bottomAllotmentRef: (handle: AllotmentHandle | null) => void;
  expandedPanel: PanelSide | null;
  layout: LayoutState;
  onLayoutChange: (updater: (current: LayoutState) => LayoutState) => void;
}): React.ReactNode {
  const rowOverlayPanel = getExpandedPanelForTarget(expandedPanel, 'editor-row');
  const workbenchOverlayPanel = getExpandedPanelForTarget(expandedPanel, 'workbench');
  // Expanded panels render as direct overlays. Docked panels stay mounted so
  // they keep owning chrome portals and panel state.
  const dockedInert = workbenchOverlayPanel !== null;

  const contentRow = (
    <div className="relative isolate h-full min-h-0 min-w-0">
      <div
        className="h-full min-h-0"
        aria-hidden={rowOverlayPanel !== null}
        inert={rowOverlayPanel !== null}
      >
        <Allotment
          ref={rightAllotmentRef}
          className="linkcode-shell-split linkcode-shell-main-right-split h-full"
          defaultSizes={[1000, layout.rightW]}
          proportionalLayout={false}
          onChange={right.split.onChange}
          onDragEnd={(sizes) => {
            right.split.onChange(sizes);
            if (right.open && !right.split.isAnimating) {
              onLayoutChange((current) => ({
                ...current,
                rightW: readPaneSize(sizes[1], current.rightW),
              }));
            }
          }}
          onReset={right.onResetSize}
        >
          <Allotment.Pane minSize={MIN_MAIN_SIZE} priority={LayoutPriority.High}>
            {main}
          </Allotment.Pane>
          <Allotment.Pane
            maxSize={RIGHT_PANEL_MAX_SIZE}
            minSize={right.split.allowZeroSize ? 0 : RIGHT_PANEL_MIN_SIZE}
            preferredSize={layout.rightW}
            visible={right.split.paneVisible}
          >
            <div aria-hidden={!right.open} inert={!right.open} className="h-full min-h-0">
              {right.node}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {rowOverlayPanel && (
        <ExpandedPanelOverlay side={rowOverlayPanel}>
          {rowOverlayPanel === 'right' ? right.expandedNode : bottom.expandedNode}
        </ExpandedPanelOverlay>
      )}
    </div>
  );

  return (
    <div className="relative isolate h-full min-h-0 min-w-0">
      <div className="h-full min-h-0" aria-hidden={dockedInert} inert={dockedInert}>
        <Allotment
          ref={bottomAllotmentRef}
          className="linkcode-shell-split h-full"
          vertical
          defaultSizes={[1000, layout.bottomH]}
          proportionalLayout={false}
          onChange={bottom.split.onChange}
          onDragEnd={(sizes) => {
            bottom.split.onChange(sizes);
            if (!bottom.open || bottom.split.isAnimating) return;
            onLayoutChange((current) => ({
              ...current,
              bottomH: readPaneSize(sizes[1], current.bottomH),
            }));
          }}
          onReset={bottom.onResetSize}
        >
          <Allotment.Pane minSize={MIN_MAIN_SIZE} priority={LayoutPriority.High}>
            {contentRow}
          </Allotment.Pane>
          <Allotment.Pane
            maxSize={BOTTOM_PANEL_MAX_SIZE}
            minSize={bottom.split.allowZeroSize ? 0 : BOTTOM_PANEL_MIN_SIZE}
            preferredSize={layout.bottomH}
            visible={bottom.split.paneVisible}
          >
            <div aria-hidden={!bottom.open} inert={!bottom.open} className="h-full min-h-0">
              {bottom.node}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {workbenchOverlayPanel && (
        <ExpandedPanelOverlay side={workbenchOverlayPanel}>
          {workbenchOverlayPanel === 'right' ? right.expandedNode : bottom.expandedNode}
        </ExpandedPanelOverlay>
      )}
    </div>
  );
}

function ExpandedPanelOverlay({
  side,
  children,
}: {
  side: PanelSide;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div data-expanded-panel={side} className="absolute inset-0 z-20 overflow-hidden bg-background">
      {children}
    </div>
  );
}
