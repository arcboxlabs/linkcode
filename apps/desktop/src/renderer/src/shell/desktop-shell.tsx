import type { SystemBridge } from '@linkcode/ipc';
import type { AgentKind } from '@linkcode/schema';
import { ConversationSurface, ErrorBanner, HostFooter, SessionSidebar } from '@linkcode/ui';
import { getChromeSurface, getWorkspaceMinSize } from '@linkcode/ui/shell/panels';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { Allotment, LayoutPriority } from 'allotment';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useSingleton } from 'foxact/use-singleton';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useShallow } from 'zustand/react/shallow';
import { DesktopChrome } from './chrome/chrome';
import { DESKTOP_CHROME_SPACER_CLASS } from './chrome/metrics';
import { DesktopPanelRegion } from './layout/panel-region';
import type { DesktopShellStyle } from './layout/shell-style';
import { createDesktopShellStyle, setShellPaneCssSize } from './layout/shell-style';
import { useAnimatedSplit } from './layout/use-animated-split';
import type { WorkspaceSide } from './layout/workspace';
import { DesktopWorkspace } from './layout/workspace';
import type { PanelSide } from './store/model';
import {
  DEFAULT_LAYOUT,
  getExpandedPanel,
  MIN_MAIN_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  readPaneSize,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
} from './store/model';
import { useDesktopShellStore } from './store/store';

export function DesktopShell({
  systemBridge,
  header,
  sessions,
  activeSession,
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
  TerminalBlockComponent,
  onDismissError,
  onModelChange,
  onOpenSettings,
}: WorkbenchShellProps & {
  systemBridge: SystemBridge;
  onOpenSettings?: () => void;
}): React.ReactNode {
  const shellState = useDesktopShellStore(
    useShallow((state) => ({
      sidebarOpen: state.sidebarOpen,
      layout: state.layout,
      expansionStack: state.expansionStack,
      rightPanel: state.rightPanel,
      bottomPanel: state.bottomPanel,
      updateSidebarOpen: state.updateSidebarOpen,
      updateLayout: state.updateLayout,
      updatePanel: state.updatePanel,
      togglePanel: state.togglePanel,
      closePanel: state.closePanel,
      addWindow: state.addWindow,
      closeTab: state.closeTab,
      toggleMaxPanel: state.toggleMaxPanel,
      resetSidebarSize: state.resetSidebarSize,
      resetRightPanelSize: state.resetRightPanelSize,
      resetBottomPanelSize: state.resetBottomPanelSize,
    })),
  );
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const { current: shellStyle } = useSingleton<DesktopShellStyle>(() =>
    createDesktopShellStyle(shellState),
  );
  const [desktopPlatform, setDesktopPlatform] = useState<NodeJS.Platform | null>(null);
  const [appVersion, setAppVersion] = useState('');
  // Desktop mounts below the connection gate, so the host is connected whenever this renders.
  const tConnection = useTranslations('workbench.connection');
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
  // The allotment ref setters are destructured to standalone identifiers: the React
  // Compiler only accepts a plain identifier in `ref={…}` — a member access there marks
  // the whole object as a ref and rejects every other render-time read of it.
  const { setAllotmentHandle: sidebarAllotmentRef, ...sidebarSplit } = useAnimatedSplit({
    open: sidebarOpen,
    paneIndex: 0,
    paneSize: layout.sidebarW,
    onPaneSizeChange: syncSidebarPaneSize,
  });
  const { setAllotmentHandle: rightAllotmentRef, ...rightSplit } = useAnimatedSplit({
    open: rightPanel.open,
    paneIndex: 1,
    paneSize: layout.rightW,
    onPaneSizeChange: syncRightPaneSize,
  });
  const { setAllotmentHandle: bottomAllotmentRef, ...bottomSplit } = useAnimatedSplit({
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
    rightAllowZeroSize: rightSplit.allowZeroSize,
    minMainSize: MIN_MAIN_SIZE,
    rightPanelMinSize: RIGHT_PANEL_MIN_SIZE,
  });

  useAbortableEffect(
    (signal) => {
      void systemBridge.app.platform().then((platform) => {
        if (!signal.aborted) setDesktopPlatform(platform);
      });
    },
    [systemBridge],
  );

  useAbortableEffect(
    (signal) => {
      void systemBridge.app.version().then((value) => {
        if (!signal.aborted) setAppVersion(`v${value}`);
      });
    },
    [systemBridge],
  );

  const active = activeSession;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';
  const agentLabel = active?.kind;
  const {
    updateSidebarOpen,
    updateLayout,
    updatePanel,
    togglePanel,
    closePanel,
    addWindow,
    closeTab,
    toggleMaxPanel,
    resetSidebarSize: resetSidebarLayoutSize,
    resetRightPanelSize: resetRightPanelLayoutSize,
    resetBottomPanelSize: resetBottomPanelLayoutSize,
  } = shellState;

  function createSession(kind: AgentKind): void {
    void systemBridge.fs
      .pickFile({ title: 'Choose working folder', directory: true })
      .then((cwd) => {
        if (!cwd) return;
        onCreateSession({ kind, cwd });
      })
      .catch(noop);
  }

  function resetSidebarSize(): void {
    sidebarSplit.setPaneSize(DEFAULT_LAYOUT.sidebarW);
    resetSidebarLayoutSize();
  }

  function resetRightPanelSize(): void {
    rightSplit.setPaneSize(DEFAULT_LAYOUT.rightW);
    resetRightPanelLayoutSize();
  }

  function resetBottomPanelSize(): void {
    bottomSplit.setPaneSize(DEFAULT_LAYOUT.bottomH);
    resetBottomPanelLayoutSize();
  }

  const main = (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ConversationSurface
        className="min-h-0 flex-1"
        conversation={conversation}
        agentKind={active?.kind}
        agentLabel={agentLabel}
        cwd={active?.cwd}
        answeredPermissions={answeredPermissions}
        respondingPermissions={respondingPermissions}
        TerminalBlockComponent={TerminalBlockComponent}
        disabled={!active || active.status === 'stopped'}
        isRunning={isRunning}
        topContent={<ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />}
        onSendPrompt={onSendPrompt}
        onStopTurn={onStopTurn}
        onRespondPermission={onRespondPermission}
        onModelChange={onModelChange}
      />
    </main>
  );

  // One renderer, two mount points: the docked instance (inside the Allotment,
  // owns the chrome tabs/controls) and the maximized overlay instance (chrome
  // suppressed — the docked instance keeps owning the chrome so the two never
  // portal duplicate tabs during the transition). Tab content mounts in exactly
  // one of them (the overlay while expanded, via contentHidden), so stateful tabs
  // like the terminal never run twice; the terminal session registry hands the
  // PTY across the remount.
  function renderPanel(
    side: PanelSide,
    options: { maximized: boolean; chromeVisible: boolean; contentHidden: boolean },
  ): React.ReactNode {
    const panel = side === 'right' ? rightPanel : bottomPanel;
    return (
      <DesktopPanelRegion
        side={side}
        panel={panel}
        maximized={options.maximized}
        chromeVisible={options.chromeVisible}
        contentHidden={options.contentHidden}
        chromeSurface={chromeSurface}
        phase={side === 'right' ? rightSplit.phase : bottomSplit.phase}
        reducedMotion={side === 'right' ? rightSplit.reducedMotion : bottomSplit.reducedMotion}
        onSelectTab={(id) => updatePanel(side, (current) => ({ ...current, activeTabId: id }))}
        onCloseTab={(id) => closeTab(side, id)}
        onAddWindow={(type) => addWindow(side, type)}
        onToggleMax={() => toggleMaxPanel(side)}
        onClose={() => closePanel(side)}
      />
    );
  }

  const workspaceRight: WorkspaceSide = {
    split: rightSplit,
    open: rightPanel.open,
    node: renderPanel('right', {
      maximized: expandedPanel === 'right',
      chromeVisible: rightSplit.paneVisible,
      contentHidden: expandedPanel === 'right',
    }),
    expandedNode: renderPanel('right', {
      maximized: true,
      chromeVisible: false,
      contentHidden: false,
    }),
    onResetSize: resetRightPanelSize,
  };
  const workspaceBottom: WorkspaceSide = {
    split: bottomSplit,
    open: bottomPanel.open,
    node: renderPanel('bottom', {
      maximized: expandedPanel === 'bottom',
      chromeVisible: bottomSplit.paneVisible,
      contentHidden: expandedPanel === 'bottom',
    }),
    expandedNode: renderPanel('bottom', {
      maximized: true,
      chromeVisible: false,
      contentHidden: false,
    }),
    onResetSize: resetBottomPanelSize,
  };

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
          ref={sidebarAllotmentRef}
          className="linkcode-shell-split linkcode-shell-sidebar-main-split h-full"
          defaultSizes={[layout.sidebarW, 1000]}
          proportionalLayout={false}
          // The sidebar already draws its own right border at the boundary, so
          // allotment's separator would stack a second offset line beside it.
          separator={false}
          onChange={sidebarSplit.onChange}
          onDragEnd={(sizes) => {
            sidebarSplit.onChange(sizes);
            if (sidebarOpen && !sidebarSplit.isAnimating) {
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
            minSize={sidebarSplit.allowZeroSize ? 0 : SIDEBAR_MIN_SIZE}
            preferredSize={layout.sidebarW}
            visible={sidebarSplit.paneVisible}
          >
            <div aria-hidden={!sidebarOpen} inert={!sidebarOpen} className="h-full min-w-0">
              <SessionSidebar
                className={sidebarClassName}
                sessions={sessions}
                activeId={active?.sessionId ?? null}
                topInsetClassName={DESKTOP_CHROME_SPACER_CLASS}
                footer={
                  <HostFooter
                    state={tConnection('connected')}
                    appVersion={appVersion}
                    pendingPermissionCount={conversation.pendingPermissionIds.length}
                    onOpenSettings={onOpenSettings}
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
              right={workspaceRight}
              bottom={workspaceBottom}
              rightAllotmentRef={rightAllotmentRef}
              bottomAllotmentRef={bottomAllotmentRef}
              expandedPanel={expandedPanel}
              layout={layout}
              onLayoutChange={updateLayout}
            />
          </Allotment.Pane>
        </Allotment>
      </DesktopChrome>
    </div>
  );
}
