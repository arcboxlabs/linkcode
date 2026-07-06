import type { SystemBridge, ThemePreference } from '@linkcode/ipc';
import {
  AgentIcon,
  ConversationSurface,
  ErrorBanner,
  HostFooter,
  SessionSidebar,
} from '@linkcode/ui';
import {
  getChromeSurface,
  getWorkspaceMinSize,
  PanelStubContent,
  PanelTabContentStack,
} from '@linkcode/ui/shell/panels';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { TerminalPanel } from '@linkcode/workbench';
import { Allotment, LayoutPriority } from 'allotment';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useSingleton } from 'foxact/use-singleton';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import { useShallow } from 'zustand/react/shallow';
import { DesktopChrome } from './chrome/chrome';
import { DiffStatChip } from './chrome/diff-stat-chip';
import { DESKTOP_CHROME_SPACER_CLASS } from './chrome/metrics';
import { DesktopPanelRegion } from './layout/panel-region';
import { DesktopRightPanelRegion } from './layout/right-panel-region';
import type { DesktopShellStyle } from './layout/shell-style';
import { createDesktopShellStyle, setShellPaneCssSize } from './layout/shell-style';
import { useAnimatedSplit } from './layout/use-animated-split';
import type { WorkspaceSide } from './layout/workspace';
import { DesktopWorkspace } from './layout/workspace';
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
import { useDesktopPaletteCommands } from './use-desktop-palette-commands';
import { getPanelToggleShortcuts, useDesktopShellShortcuts } from './use-desktop-shell-shortcuts';

export function DesktopShell({
  systemBridge,
  header,
  threadGroups,
  workspaces,
  workspacesLoading,
  sessionsLoading,
  activeSession,
  conversation,
  permissionDecisions,
  respondingPermissions,
  errorMessage,
  pinnedSessionIds,
  onSelectSession,
  onCloseSession,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onCreateSession,
  onImportSession,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  onToggleImportHistory,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onOpenSearch,
  TerminalBlockComponent,
  BranchStatusComponent,
  HistoryComponent,
  onDismissError,
  onModelChange,
  onEffortChange,
  onOpenSettings,
  themeType,
}: WorkbenchShellProps & {
  systemBridge: SystemBridge;
  onOpenSettings?: () => void;
  themeType: ThemePreference;
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
      setActiveSection: state.setActiveSection,
      openRightPanelSection: state.openRightPanelSection,
      addRightTerminalTab: state.addRightTerminalTab,
      closeRightTerminalTab: state.closeRightTerminalTab,
      setActiveRightTerminalTab: state.setActiveRightTerminalTab,
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
  // Content boxes reported by the active panel-region instances (docked or maximized overlay).
  const [rightContentTarget, setRightContentTarget] = useState<HTMLDivElement | null>(null);
  const [bottomContentTarget, setBottomContentTarget] = useState<HTMLDivElement | null>(null);
  // Persistent portal hosts. The portal CONTAINER must never change — React keys a portal by its
  // container, so portaling into the reported target directly would remount the whole subtree on
  // every docked↔maximized handoff. Instead each side portals into one stable host div, and a
  // layout effect moves that div between targets — a same-document DOM move, which preserves the
  // React tree and the terminal's canvas.
  const { current: rightContentHost } = useSingleton(() => createPanelContentHost());
  const { current: bottomContentHost } = useSingleton(() => createPanelContentHost());
  useLayoutEffect(() => {
    if (rightContentTarget !== null) rightContentTarget.append(rightContentHost);
  }, [rightContentTarget, rightContentHost]);
  useLayoutEffect(() => {
    if (bottomContentTarget !== null) bottomContentTarget.append(bottomContentHost);
  }, [bottomContentTarget, bottomContentHost]);
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
  // Tab content mounts lazily on the panel's first settled open, so no shell is spawned for a
  // panel that is never shown. Latched during render — React's prescribed state adjustment.
  const [rightContentMounted, setRightContentMounted] = useState(false);
  if (rightSplit.phase === 'open' && !rightContentMounted) setRightContentMounted(true);
  const [bottomContentMounted, setBottomContentMounted] = useState(false);
  if (bottomSplit.phase === 'open' && !bottomContentMounted) setBottomContentMounted(true);

  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';
  // Hints mirror the window keydown bindings below; hidden until the platform is known.
  const panelShortcuts = getPanelToggleShortcuts(desktopPlatform);
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
  const titledSession = active?.title === undefined ? null : active;
  const hideMainTitle = active === null ? false : titledSession === null;
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
    setActiveSection,
    openRightPanelSection,
    addRightTerminalTab,
    closeRightTerminalTab,
    setActiveRightTerminalTab,
    resetSidebarSize: resetSidebarLayoutSize,
    resetRightPanelSize: resetRightPanelLayoutSize,
    resetBottomPanelSize: resetBottomPanelLayoutSize,
  } = shellState;

  useDesktopShellShortcuts({ desktopPlatform, togglePanel, updateSidebarOpen });

  const pickDirectory = useCallback(
    () => systemBridge.fs.pickFile({ title: 'Choose working folder', directory: true }),
    [systemBridge],
  );

  useDesktopPaletteCommands({
    desktopPlatform,
    pickDirectory,
    onRegisterWorkspace,
    onOpenSettings,
    togglePanel,
    updateSidebarOpen,
  });

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
      <div aria-hidden className={`${DESKTOP_CHROME_SPACER_CLASS} shrink-0`} />
      {/* Keyed per session: switching resets the composer draft and scroll without touching the shell. */}
      <ConversationSurface
        key={active?.sessionId ?? 'no-active-session'}
        className="min-h-0 flex-1"
        conversation={conversation}
        agentKind={active?.kind}
        agentLabel={agentLabel}
        cwd={active?.cwd}
        permissionDecisions={permissionDecisions}
        respondingPermissions={respondingPermissions}
        TerminalBlockComponent={TerminalBlockComponent}
        disabled={!active || active.status === 'stopped'}
        isRunning={isRunning}
        topContent={<ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />}
        onSendPrompt={onSendPrompt}
        onStopTurn={onStopTurn}
        onRespondPermission={onRespondPermission}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </main>
  );

  // One renderer, two mount points per side: the docked instance (inside the Allotment, owns the
  // chrome tabs/controls) and the maximized overlay instance (chrome suppressed — the docked
  // instance keeps owning the chrome so the two never portal duplicate tabs during the
  // transition). Tab content mounts in exactly one of them (the overlay while expanded, via
  // contentHidden), so stateful tabs like the terminal never run twice; the terminal session
  // registry hands the PTY across the remount.
  function renderRightPanel(options: {
    maximized: boolean;
    chromeVisible: boolean;
    contentHidden: boolean;
  }): React.ReactNode {
    return (
      <DesktopRightPanelRegion
        panel={rightPanel}
        cwd={active?.cwd}
        themeType={themeType}
        maximized={options.maximized}
        chromeVisible={options.chromeVisible}
        contentHidden={options.contentHidden}
        chromeSurface={chromeSurface}
        phase={rightSplit.phase}
        reducedMotion={rightSplit.reducedMotion}
        terminalContentTargetRef={setRightContentTarget}
        onSelectSection={setActiveSection}
        onSelectTerminalTab={setActiveRightTerminalTab}
        onCloseTerminalTab={closeRightTerminalTab}
        onAddTerminalTab={addRightTerminalTab}
        onToggleMax={() => toggleMaxPanel('right')}
      />
    );
  }

  function renderBottomPanel(options: {
    maximized: boolean;
    chromeVisible: boolean;
    contentHidden: boolean;
  }): React.ReactNode {
    return (
      <DesktopPanelRegion
        side="bottom"
        panel={bottomPanel}
        maximized={options.maximized}
        chromeVisible={options.chromeVisible}
        contentHidden={options.contentHidden}
        chromeSurface={chromeSurface}
        phase={bottomSplit.phase}
        reducedMotion={bottomSplit.reducedMotion}
        contentTargetRef={setBottomContentTarget}
        onSelectTab={(id) => updatePanel((current) => ({ ...current, activeTabId: id }))}
        onCloseTab={(id) => closeTab(id)}
        onAddWindow={(type) => addWindow(type)}
        onToggleMax={() => toggleMaxPanel('bottom')}
        onClose={() => closePanel('bottom')}
      />
    );
  }

  // The shell owns the right panel's Terminal-section PTY stack and portals it into whichever
  // region instance (docked or maximized overlay) currently shows content — `contentHidden`
  // guarantees exactly one target exists at a time — so a terminal keeps its live renderer across
  // the handoff. Content mounts lazily on the panel's first open: no shell is spawned for a panel
  // never shown. Diff/Browser section content is stateless (SWR-backed) and stays inline in
  // `DesktopRightPanelRegion`, so only the Terminal stack needs this treatment.
  function renderRightPanelContents(host: HTMLDivElement): React.ReactNode {
    const activeIsTerminal = rightPanel.activeSection === 'terminal';
    const items = rightPanel.terminal.tabs.map((tab) => ({
      id: tab.id,
      active: activeIsTerminal && tab.id === rightPanel.terminal.activeTabId,
      node: (
        <TerminalPanel
          sessionKey={tab.id}
          cwd={active?.cwd}
          suspended={rightSplit.phase !== 'open'}
        />
      ),
    }));
    return createPortal(<PanelTabContentStack items={items} />, host);
  }

  // Same portal treatment for the bottom panel's flat tab strip.
  function renderBottomPanelContents(host: HTMLDivElement): React.ReactNode {
    const items = bottomPanel.tabs.map((tab) => ({
      id: tab.id,
      active: tab.id === bottomPanel.activeTabId,
      node:
        tab.type === 'terminal' ? (
          <TerminalPanel
            sessionKey={tab.id}
            cwd={active?.cwd}
            suspended={bottomSplit.phase !== 'open'}
          />
        ) : (
          <PanelStubContent type={tab.type} />
        ),
    }));
    return createPortal(<PanelTabContentStack items={items} />, host);
  }

  const workspaceRight: WorkspaceSide = {
    split: rightSplit,
    open: rightPanel.open,
    node: renderRightPanel({
      maximized: expandedPanel === 'right',
      chromeVisible: rightSplit.paneVisible,
      contentHidden: expandedPanel === 'right',
    }),
    expandedNode: renderRightPanel({
      maximized: true,
      chromeVisible: false,
      contentHidden: false,
    }),
    onResetSize: resetRightPanelSize,
  };
  const workspaceBottom: WorkspaceSide = {
    split: bottomSplit,
    open: bottomPanel.open,
    node: renderBottomPanel({
      maximized: expandedPanel === 'bottom',
      chromeVisible: bottomSplit.paneVisible,
      contentHidden: expandedPanel === 'bottom',
    }),
    expandedNode: renderBottomPanel({
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
        sidebarShortcut={panelShortcuts.sidebar}
        rightPanelShortcut={panelShortcuts.right}
        bottomPanelShortcut={panelShortcuts.bottom}
        titleContent={hideMainTitle ? null : undefined}
        titleIcon={
          titledSession ? (
            <AgentIcon className="text-foreground" kind={titledSession.kind} variant="ghost" />
          ) : undefined
        }
        titleChip={
          titledSession ? (
            <DiffStatChip
              cwd={titledSession.cwd}
              onOpenDiff={() => openRightPanelSection('diff')}
            />
          ) : undefined
        }
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
                threadGroups={threadGroups}
                workspaces={workspaces}
                workspacesLoading={workspacesLoading}
                sessionsLoading={sessionsLoading}
                activeId={active?.sessionId ?? null}
                pinnedSessionIds={pinnedSessionIds}
                topInsetClassName={DESKTOP_CHROME_SPACER_CLASS}
                footer={
                  <HostFooter
                    state={tConnection('connected')}
                    appVersion={appVersion}
                    pendingPermissionCount={conversation.pendingPermissionIds.length}
                    onOpenSettings={onOpenSettings}
                  />
                }
                onImportSession={onImportSession}
                onPickDirectory={pickDirectory}
                onOpenSearch={onOpenSearch}
                searchShortcut={panelShortcuts.palette}
                onRegisterWorkspace={onRegisterWorkspace}
                onRenameWorkspace={onRenameWorkspace}
                onArchiveWorkspace={onArchiveWorkspace}
                onToggleGroupCollapsed={onToggleGroupCollapsed}
                onTogglePreviewExpanded={onTogglePreviewExpanded}
                onToggleImportHistory={onToggleImportHistory}
                BranchStatusComponent={BranchStatusComponent}
                HistoryComponent={HistoryComponent}
                onSelect={onSelectSession}
                onClose={onCloseSession}
                onToggleSessionPinned={onToggleSessionPinned}
                onReorderGroups={onReorderGroups}
                onReorderThreads={onReorderThreads}
                onCreate={onCreateSession}
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
      {rightContentMounted && renderRightPanelContents(rightContentHost)}
      {bottomContentMounted && renderBottomPanelContents(bottomContentHost)}
    </div>
  );
}

function createPanelContentHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'absolute inset-0';
  return host;
}
