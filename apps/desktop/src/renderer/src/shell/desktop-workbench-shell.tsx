import type { SystemBridge } from '@linkcode/ipc';
import type { AgentKind } from '@linkcode/schema';
import type { PanelWindowType } from '@linkcode/ui';
import { SessionSidebar, WorkbenchConversationSurface } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { Allotment, LayoutPriority } from 'allotment';
import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { XIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { systemBridge } from '@/ipc';
import { DesktopChrome } from './chrome/chrome';
import type { DesktopChromeMetricsStyle } from './chrome/metrics';
import { DESKTOP_CHROME_METRICS_STYLE, DESKTOP_CHROME_SPACER_CLASS } from './chrome/metrics';
import { DesktopHostFooter } from './host/host-footer';
import { getShellContentMotionStyle, useAnimatedSplit } from './layout/use-animated-split';
import { DesktopWorkspace } from './layout/workspace';
import { getChromeSurface, getWorkspaceMinSize } from './panels/panel-layout';
import { PanelRegion } from './panels/panel-region';
import type { DesktopShellState, LayoutState, PanelSide, PanelState } from './state/local/model';
import {
  createTab,
  DEFAULT_LAYOUT,
  defaultWindowFor,
  getExpandedPanel,
  getPanelFromShellState,
  normalizeLayout,
  pushExpandedPanel,
  readPaneSize,
  removeExpandedPanel,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  setPanelInShellState,
} from './state/local/model';
import { useDesktopShellState } from './state/local/storage';

type DesktopPlatform = 'darwin' | 'win32' | 'other';

type DesktopShellStyle = CSSProperties &
  DesktopChromeMetricsStyle & {
    '--lc-sidebar-w': string;
    '--lc-right-w': string;
    '--lc-bottom-h': string;
  };

type DesktopShellPaneCssProperty = '--lc-sidebar-w' | '--lc-right-w' | '--lc-bottom-h';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): ReactNode {
  return <DesktopShell systemBridge={systemBridge} header={header} {...props} />;
}

function DesktopShell({
  systemBridge,
  header,
  sessions,
  activeId,
  conversation,
  answeredPermissions,
  respondingPermissions,
  errorMessage,
  onSelectSession,
  onStopSession,
  onCreateSession,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onDismissError,
}: WorkbenchShellProps & { systemBridge: SystemBridge }): ReactNode {
  const [shellState, setShellState] = useDesktopShellState();
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const [shellStyle] = useState<DesktopShellStyle>(() => createDesktopShellStyle(shellState));
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform>(() =>
    initialDesktopPlatform(),
  );
  const syncSidebarPaneSize = useCallback((size: number): void => {
    setShellPaneCssSize(shellRootRef.current, '--lc-sidebar-w', size);
  }, []);
  const syncRightPaneSize = useCallback((size: number): void => {
    setShellPaneCssSize(shellRootRef.current, '--lc-right-w', size);
  }, []);
  const syncBottomPaneSize = useCallback((size: number): void => {
    setShellPaneCssSize(shellRootRef.current, '--lc-bottom-h', size);
  }, []);
  const { sidebarOpen, layout, expansionStack, rightPanel, bottomPanel } = shellState;
  const {
    setAllotmentHandle: setSidebarAllotmentHandle,
    setPaneSize: setSidebarPaneSize,
    allowZeroSize: sidebarAllowZeroSize,
    isAnimating: sidebarIsAnimating,
    paneVisible: sidebarPaneVisible,
    onChange: handleSidebarSplitChange,
  } = useAnimatedSplit({
    open: sidebarOpen,
    paneIndex: 0,
    paneSize: layout.sidebarW,
    onPaneSizeChange: syncSidebarPaneSize,
  });
  const {
    setAllotmentHandle: setRightAllotmentHandle,
    setPaneSize: setRightPaneSize,
    allowZeroSize: rightAllowZeroSize,
    isAnimating: rightIsAnimating,
    paneVisible: rightPaneVisible,
    phase: rightPhase,
    reducedMotion: rightReducedMotion,
    onChange: handleRightSplitChange,
  } = useAnimatedSplit({
    open: rightPanel.open,
    paneIndex: 1,
    paneSize: layout.rightW,
    onPaneSizeChange: syncRightPaneSize,
  });
  const {
    setAllotmentHandle: setBottomAllotmentHandle,
    setPaneSize: setBottomPaneSize,
    allowZeroSize: bottomAllowZeroSize,
    isAnimating: bottomIsAnimating,
    paneVisible: bottomPaneVisible,
    phase: bottomPhase,
    reducedMotion: bottomReducedMotion,
    onChange: handleBottomSplitChange,
  } = useAnimatedSplit({
    open: bottomPanel.open,
    paneIndex: 1,
    paneSize: layout.bottomH,
    onPaneSizeChange: syncBottomPaneSize,
  });
  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';
  const sidebarClassName = hasNativeBackdrop ? 'bg-sidebar/25' : 'bg-sidebar';
  const expandedPanel = getExpandedPanel(expansionStack, rightPanel.open, bottomPanel.open);
  const chromeSurface = getChromeSurface(expandedPanel);
  const workspaceMinSize = getWorkspaceMinSize({
    rightPanelOpen: rightPanel.open,
    rightAllowZeroSize,
  });

  useAbortableEffect(
    (signal) => {
      void systemBridge.app.platform().then((platform) => {
        if (!signal.aborted) setDesktopPlatform(toDesktopPlatform(platform));
      });
    },
    [systemBridge],
  );

  const active = sessions.find((session) => session.sessionId === activeId) ?? null;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';
  const agentLabel = active?.kind;

  function updateShellState(updater: (current: DesktopShellState) => DesktopShellState): void {
    setShellState((current) => updater(current ?? shellState));
  }

  function createSession(kind: AgentKind): void {
    void systemBridge.fs
      .pickFile({ title: 'Choose working folder', directory: true })
      .then((cwd) => {
        if (!cwd) return;
        onCreateSession({ kind, cwd });
      })
      .catch(noop);
  }

  function updateSidebarOpen(updater: boolean | ((current: boolean) => boolean)): void {
    updateShellState((current) => {
      const sidebarOpen = typeof updater === 'function' ? updater(current.sidebarOpen) : updater;
      return { ...current, sidebarOpen };
    });
  }

  function updateLayout(updater: (current: LayoutState) => LayoutState): void {
    updateShellState((current) => ({
      ...current,
      layout: normalizeLayout(updater(current.layout)),
    }));
  }

  function resetSidebarSize(): void {
    setSidebarPaneSize(DEFAULT_LAYOUT.sidebarW);
    updateLayout((current) => ({ ...current, sidebarW: DEFAULT_LAYOUT.sidebarW }));
  }

  function resetRightPanelSize(): void {
    setRightPaneSize(DEFAULT_LAYOUT.rightW);
    updateLayout((current) => ({ ...current, rightW: DEFAULT_LAYOUT.rightW }));
  }

  function resetBottomPanelSize(): void {
    setBottomPaneSize(DEFAULT_LAYOUT.bottomH);
    updateLayout((current) => ({ ...current, bottomH: DEFAULT_LAYOUT.bottomH }));
  }

  function updatePanel(side: PanelSide, updater: (panel: PanelState) => PanelState): void {
    updateShellState((current) =>
      setPanelInShellState(current, side, updater(getPanelFromShellState(current, side))),
    );
  }

  function togglePanel(side: PanelSide): void {
    updateShellState((current) => {
      const panel = getPanelFromShellState(current, side);
      const open = !panel.open;
      const tabs = panel.tabs.length > 0 ? panel.tabs : [createTab(defaultWindowFor(side))];
      const nextPanel = {
        ...panel,
        open,
        tabs,
        activeTabId: open ? (panel.activeTabId ?? tabs[0].id) : panel.activeTabId,
      };
      return setPanelInShellState(
        {
          ...current,
          expansionStack: open
            ? current.expansionStack
            : removeExpandedPanel(current.expansionStack, side),
        },
        side,
        nextPanel,
      );
    });
  }

  function closePanel(side: PanelSide): void {
    updateShellState((current) =>
      setPanelInShellState(
        { ...current, expansionStack: removeExpandedPanel(current.expansionStack, side) },
        side,
        { ...getPanelFromShellState(current, side), open: false },
      ),
    );
  }

  function addWindow(side: PanelSide, type: PanelWindowType): void {
    const tab = createTab(type);
    updateShellState((current) => {
      const panel = getPanelFromShellState(current, side);
      return setPanelInShellState(current, side, {
        ...panel,
        open: true,
        tabs: [...panel.tabs, tab],
        activeTabId: tab.id,
      });
    });
  }

  function closeTab(side: PanelSide, id: string): void {
    updateShellState((current) => {
      const panel = getPanelFromShellState(current, side);
      const index = panel.tabs.findIndex((tab) => tab.id === id);
      const tabs = panel.tabs.filter((tab) => tab.id !== id);
      if (tabs.length === 0) {
        return setPanelInShellState(
          { ...current, expansionStack: removeExpandedPanel(current.expansionStack, side) },
          side,
          { ...panel, open: false, tabs, activeTabId: null },
        );
      }
      const fallback = tabs[Math.max(0, Math.min(index, tabs.length - 1))];
      return setPanelInShellState(current, side, {
        ...panel,
        tabs,
        activeTabId: panel.activeTabId === id ? fallback.id : panel.activeTabId,
      });
    });
  }

  function toggleMaxPanel(side: PanelSide): void {
    updateShellState((current) => {
      const activeExpandedPanel = getExpandedPanel(
        current.expansionStack,
        current.rightPanel.open,
        current.bottomPanel.open,
      );

      return {
        ...current,
        expansionStack:
          activeExpandedPanel === side
            ? removeExpandedPanel(current.expansionStack, side)
            : pushExpandedPanel(current.expansionStack, side),
      };
    });
  }

  const main = (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <WorkbenchConversationSurface
        className="min-h-0 flex-1"
        conversation={conversation}
        agentKind={active?.kind}
        agentLabel={agentLabel}
        cwd={active?.cwd}
        answeredPermissions={answeredPermissions}
        respondingPermissions={respondingPermissions}
        disabled={!activeId}
        isRunning={isRunning}
        topContent={
          <DesktopErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />
        }
        onSendPrompt={onSendPrompt}
        onStopTurn={onStopTurn}
        onRespondPermission={onRespondPermission}
      />
    </main>
  );

  // One renderer, two mount points: the docked instance (inside the Allotment,
  // owns the chrome tabs/controls) and the maximized overlay instance (chrome
  // suppressed — the docked instance keeps owning the chrome so the two never
  // portal duplicate tabs during the transition).
  function renderPanel(
    side: PanelSide,
    options: { maximized: boolean; chromeVisible: boolean },
  ): ReactNode {
    const panel = side === 'right' ? rightPanel : bottomPanel;
    return (
      <PanelRegion
        side={side}
        panel={panel}
        maximized={options.maximized}
        chromeVisible={options.chromeVisible}
        chromeSurface={chromeSurface}
        contentStyle={getShellContentMotionStyle({
          axis: side === 'right' ? 'x' : 'y',
          phase: side === 'right' ? rightPhase : bottomPhase,
          reducedMotion: side === 'right' ? rightReducedMotion : bottomReducedMotion,
        })}
        onSelectTab={(id) => updatePanel(side, (current) => ({ ...current, activeTabId: id }))}
        onCloseTab={(id) => closeTab(side, id)}
        onAddWindow={(type) => addWindow(side, type)}
        onToggleMax={() => toggleMaxPanel(side)}
        onClose={() => closePanel(side)}
      />
    );
  }

  return (
    <div
      ref={shellRootRef}
      className="linkcode-desktop-shell relative h-full bg-transparent text-foreground"
      style={shellStyle}
    >
      <DesktopChrome
        header={header}
        sidebarOpen={sidebarOpen}
        rightPanelOpen={rightPanel.open}
        bottomPanelOpen={bottomPanel.open}
        expandedPanel={expandedPanel}
        hasNativeBackdrop={hasNativeBackdrop}
        hasNativeTrafficLights={hasNativeTrafficLights}
        onShowSidebar={() => updateSidebarOpen(true)}
        onHideSidebar={() => updateSidebarOpen(false)}
        onToggleRight={() => togglePanel('right')}
        onToggleBottom={() => togglePanel('bottom')}
      >
        <Allotment
          ref={setSidebarAllotmentHandle}
          className="linkcode-shell-split linkcode-shell-sidebar-main-split h-full"
          defaultSizes={[layout.sidebarW, 1000]}
          proportionalLayout={false}
          // The sidebar already draws its own right border at the boundary, so
          // allotment's separator would stack a second offset line beside it.
          separator={false}
          onChange={handleSidebarSplitChange}
          onDragEnd={(sizes) => {
            handleSidebarSplitChange(sizes);
            if (sidebarOpen && !sidebarIsAnimating) {
              updateLayout((current) => ({
                ...current,
                sidebarW: readPaneSize(sizes[0], current.sidebarW),
              }));
            }
          }}
          onReset={resetSidebarSize}
        >
          <Allotment.Pane
            maxSize={SIDEBAR_MAX_SIZE}
            minSize={sidebarAllowZeroSize ? 0 : SIDEBAR_MIN_SIZE}
            preferredSize={layout.sidebarW}
            visible={sidebarPaneVisible}
          >
            <div aria-hidden={!sidebarOpen} inert={!sidebarOpen} className="h-full min-w-0">
              <SessionSidebar
                className={sidebarClassName}
                sessions={sessions}
                activeId={activeId}
                topInsetClassName={DESKTOP_CHROME_SPACER_CLASS}
                footer={
                  <DesktopHostFooter
                    systemBridge={systemBridge}
                    pendingPermissionCount={conversation.pendingPermissionIds.length}
                  />
                }
                onSelect={onSelectSession}
                onStop={onStopSession}
                onCreate={createSession}
              />
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={workspaceMinSize} priority={LayoutPriority.High}>
            <DesktopWorkspace
              main={main}
              renderPanel={renderPanel}
              expandedPanel={expandedPanel}
              rightPanelOpen={rightPanel.open}
              bottomPanelOpen={bottomPanel.open}
              setRightAllotmentHandle={setRightAllotmentHandle}
              rightAllowZeroSize={rightAllowZeroSize}
              rightIsAnimating={rightIsAnimating}
              rightPaneVisible={rightPaneVisible}
              rightOnChange={handleRightSplitChange}
              setBottomAllotmentHandle={setBottomAllotmentHandle}
              bottomAllowZeroSize={bottomAllowZeroSize}
              bottomIsAnimating={bottomIsAnimating}
              bottomPaneVisible={bottomPaneVisible}
              bottomOnChange={handleBottomSplitChange}
              layout={layout}
              onLayoutChange={updateLayout}
              onResetRightSize={resetRightPanelSize}
              onResetBottomSize={resetBottomPanelSize}
            />
          </Allotment.Pane>
        </Allotment>
      </DesktopChrome>
    </div>
  );
}

function DesktopErrorBanner({
  errorMessage,
  onDismissError,
}: {
  errorMessage?: string | null;
  onDismissError?: () => void;
}): ReactNode {
  if (!errorMessage) return null;

  return (
    <div className="border-border border-b px-4 py-2">
      <Alert variant="error" className="rounded-md py-2">
        <AlertTitle>Action failed</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
        {onDismissError && (
          <AlertAction>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onDismissError}>
              <XIcon />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}

function initialDesktopPlatform(): DesktopPlatform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('win')) return 'win32';
  return 'other';
}

function toDesktopPlatform(platform: string): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform;
  return 'other';
}

function createDesktopShellStyle(state: DesktopShellState): DesktopShellStyle {
  return {
    ...DESKTOP_CHROME_METRICS_STYLE,
    '--lc-sidebar-w': `${state.sidebarOpen ? state.layout.sidebarW : 0}px`,
    '--lc-right-w': `${state.rightPanel.open ? state.layout.rightW : 0}px`,
    '--lc-bottom-h': `${state.bottomPanel.open ? state.layout.bottomH : 0}px`,
  };
}

function setShellPaneCssSize(
  element: HTMLElement | null,
  property: DesktopShellPaneCssProperty,
  size: number,
): void {
  element?.style.setProperty(property, `${Math.max(0, size)}px`);
}
