import type { LayoutState, PanelSide } from '@desktop/shell/state/local/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  getExpandedPanelForTarget,
  MIN_MAIN_SIZE,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  readPaneSize,
} from '@desktop/shell/state/local/model';
import type { AllotmentHandle } from 'allotment';
import { Allotment, LayoutPriority } from 'allotment';
import type { ReactNode } from 'react';

export function DesktopWorkspace({
  main,
  renderPanel,
  expandedPanel,
  rightPanelOpen,
  bottomPanelOpen,
  setRightAllotmentHandle,
  rightAllowZeroSize,
  rightIsAnimating,
  rightPaneVisible,
  rightOnChange,
  setBottomAllotmentHandle,
  bottomAllowZeroSize,
  bottomIsAnimating,
  bottomPaneVisible,
  bottomOnChange,
  layout,
  onLayoutChange,
  onResetRightSize,
  onResetBottomSize,
}: {
  main: ReactNode;
  renderPanel: (
    side: PanelSide,
    options: { maximized: boolean; chromeVisible: boolean },
  ) => ReactNode;
  expandedPanel: PanelSide | null;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  setRightAllotmentHandle: (handle: AllotmentHandle | null) => void;
  rightAllowZeroSize: boolean;
  rightIsAnimating: boolean;
  rightPaneVisible: boolean;
  rightOnChange: (sizes: number[]) => void;
  setBottomAllotmentHandle: (handle: AllotmentHandle | null) => void;
  bottomAllowZeroSize: boolean;
  bottomIsAnimating: boolean;
  bottomPaneVisible: boolean;
  bottomOnChange: (sizes: number[]) => void;
  layout: LayoutState;
  onLayoutChange: (updater: (current: LayoutState) => LayoutState) => void;
  onResetRightSize: () => void;
  onResetBottomSize: () => void;
}): ReactNode {
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
          ref={setRightAllotmentHandle}
          className="linkcode-shell-split linkcode-shell-main-right-split h-full"
          defaultSizes={[1000, layout.rightW]}
          proportionalLayout={false}
          onChange={rightOnChange}
          onDragEnd={(sizes) => {
            rightOnChange(sizes);
            if (rightPanelOpen && !rightIsAnimating) {
              onLayoutChange((current) => ({
                ...current,
                rightW: readPaneSize(sizes[1], current.rightW),
              }));
            }
          }}
          onReset={onResetRightSize}
        >
          <Allotment.Pane minSize={MIN_MAIN_SIZE} priority={LayoutPriority.High}>
            {main}
          </Allotment.Pane>
          <Allotment.Pane
            maxSize={RIGHT_PANEL_MAX_SIZE}
            minSize={rightAllowZeroSize ? 0 : RIGHT_PANEL_MIN_SIZE}
            preferredSize={layout.rightW}
            visible={rightPaneVisible}
          >
            <div aria-hidden={!rightPanelOpen} inert={!rightPanelOpen} className="h-full min-h-0">
              {renderPanel('right', {
                maximized: expandedPanel === 'right',
                chromeVisible: rightPaneVisible,
              })}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {rowOverlayPanel && (
        <ExpandedPanelOverlay side={rowOverlayPanel}>
          {renderPanel(rowOverlayPanel, { maximized: true, chromeVisible: false })}
        </ExpandedPanelOverlay>
      )}
    </div>
  );

  return (
    <div className="relative isolate h-full min-h-0 min-w-0">
      <div className="h-full min-h-0" aria-hidden={dockedInert} inert={dockedInert}>
        <Allotment
          ref={setBottomAllotmentHandle}
          className="linkcode-shell-split h-full"
          vertical
          defaultSizes={[1000, layout.bottomH]}
          proportionalLayout={false}
          onChange={bottomOnChange}
          onDragEnd={(sizes) => {
            bottomOnChange(sizes);
            if (!bottomPanelOpen || bottomIsAnimating) return;
            onLayoutChange((current) => ({
              ...current,
              bottomH: readPaneSize(sizes[1], current.bottomH),
            }));
          }}
          onReset={onResetBottomSize}
        >
          <Allotment.Pane minSize={MIN_MAIN_SIZE} priority={LayoutPriority.High}>
            {contentRow}
          </Allotment.Pane>
          <Allotment.Pane
            maxSize={BOTTOM_PANEL_MAX_SIZE}
            minSize={bottomAllowZeroSize ? 0 : BOTTOM_PANEL_MIN_SIZE}
            preferredSize={layout.bottomH}
            visible={bottomPaneVisible}
          >
            <div aria-hidden={!bottomPanelOpen} inert={!bottomPanelOpen} className="h-full min-h-0">
              {renderPanel('bottom', {
                maximized: expandedPanel === 'bottom',
                chromeVisible: bottomPaneVisible,
              })}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {workbenchOverlayPanel && (
        <ExpandedPanelOverlay side={workbenchOverlayPanel}>
          {renderPanel(workbenchOverlayPanel, { maximized: true, chromeVisible: false })}
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
  children: ReactNode;
}): ReactNode {
  return (
    <div data-expanded-panel={side} className="absolute inset-0 z-20 overflow-hidden bg-background">
      {children}
    </div>
  );
}
