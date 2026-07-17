import type { SystemBridge, ThemePreference } from '@linkcode/ipc';
import type { ComposerAttachment } from '@linkcode/ui';
import {
  AgentIcon,
  ConversationSurface,
  ErrorBadge,
  ErrorBanner,
  HostFooter,
  NewSessionSurface,
  SessionSidebar,
  useKeyboardShortcutLabel,
} from '@linkcode/ui';
import {
  getChromeSurface,
  PanelStubContent,
  PanelTabContentStack,
} from '@linkcode/ui/shell/panels';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import {
  AttachedTerminalPanel,
  isAbsoluteFilePath,
  locateFileArtifact,
  TerminalPanel,
  useCloudHosts,
  useSelectedHostStore,
  WorkspaceServicesMenu,
} from '@linkcode/workbench';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useSingleton } from 'foxact/use-singleton';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFormatter, useTranslations } from 'use-intl';
import { useShallow } from 'zustand/react/shallow';
import { DesktopThreadImMenu } from '../cloud-auth/thread-im-menu';
import { useCloudAccount } from '../cloud-auth/use-cloud-account';
import { BrowserWebviewPane } from './browser/browser-webview-pane';
import { DesktopChrome } from './chrome/chrome';
import { DiffStatChip } from './chrome/diff-stat-chip';
import { DESKTOP_CHROME_SPACER_CLASS } from './chrome/metrics';
import { usePaneTransition } from './layout/pane-transition';
import { DesktopPanelRegion } from './layout/panel-region';
import { DesktopRightPanelRegion } from './layout/right-panel-region';
import type { DesktopShellStyle } from './layout/shell-style';
import { createDesktopShellStyle, setShellPaneCssSize } from './layout/shell-style';
import type { WorkspaceSide } from './layout/workspace';
import { DesktopWorkspace } from './layout/workspace';
import { getExpandedPanel } from './store/model';
import { useDesktopShellStore } from './store/store';
import { useDesktopPaletteCommands } from './use-desktop-palette-commands';
import { useDesktopShellShortcuts } from './use-desktop-shell-shortcuts';

export function DesktopShell({
  systemBridge,
  header,
  navigation,
  threadGroups,
  workspaces,
  workspacesLoading,
  sessionsLoading,
  chatWorkspace,
  activeSession,
  draft,
  runtimeCues,
  attachmentSupport,
  onDownloadAgent,
  onContinueUnverified,
  onLoginAgent,
  onSubmitLoginCode,
  onCancelLogin,
  conversation,
  respondingRequestIds,
  responseErrors,
  errorMessage,
  pinnedSessionIds,
  collapsedSections,
  onSelectSession,
  onCloseSession,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onSubmitDraft,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onToggleSectionCollapsed,
  onTogglePreviewExpanded,
  mentionItems,
  onMentionQueryChange,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onRespondQuestion,
  onHostArtifact,
  onReadAttachmentFile,
  onOpenSearch,
  onOpenAutomations,
  searchShortcut,
  TerminalBlockComponent,
  BranchStatusComponent,
  onDismissError,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
  onOpenSettings,
  onImportHistory,
  themeType,
}: WorkbenchShellProps & {
  systemBridge: SystemBridge;
  onOpenSettings?: () => void;
  /** Opens the desktop settings overlay on the History import category. */
  onImportHistory?: () => void;
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
      openRightFileTab: state.openRightFileTab,
      closeRightFileTab: state.closeRightFileTab,
      setActiveRightFileTab: state.setActiveRightFileTab,
      openBrowserUrl: state.openBrowserUrl,
      openRightTerminalAttachTab: state.openRightTerminalAttachTab,
      resetSidebarSize: state.resetSidebarSize,
      resetRightPanelSize: state.resetRightPanelSize,
      resetBottomPanelSize: state.resetBottomPanelSize,
    })),
  );
  const cloudAuth = useCloudAccount();
  const remoteHosts = useCloudHosts(cloudAuth.account?.email ?? null);
  const { selectedHostId, selectHost } = useSelectedHostStore(
    useShallow((state) => ({ selectedHostId: state.selectedHostId, selectHost: state.selectHost })),
  );
  const format = useFormatter();
  const remoteHostItems = remoteHosts.data?.map((host) => ({
    id: host.hostId,
    name: host.name ?? host.hostId,
    statusLabel: format.relativeTime(host.lastSeen),
  }));
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const { current: shellStyle } = useSingleton<DesktopShellStyle>(() =>
    createDesktopShellStyle(shellState),
  );
  const desktopPlatform = systemBridge.app.platform;
  const [appVersion, setAppVersion] = useState('');
  const sidebarShortcut = useKeyboardShortcutLabel('desktop.toggle-sidebar');
  const bottomPanelShortcut = useKeyboardShortcutLabel('desktop.toggle-bottom-panel');
  const rightPanelShortcut = useKeyboardShortcutLabel('desktop.toggle-right-panel');
  // Content boxes reported by the active panel-region instances (docked or maximized overlay).
  const [rightContentTarget, setRightContentTarget] = useState<HTMLDivElement | null>(null);
  const [bottomContentTarget, setBottomContentTarget] = useState<HTMLDivElement | null>(null);
  // Persistent portal hosts: React keys a portal by its container, so portaling into the reported
  // target directly would remount the subtree on every docked↔maximized handoff. Each side portals
  // into one stable host div that a layout effect moves between targets — a same-document DOM
  // move, preserving the React tree and the terminal's canvas.
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
  const tComposer = useTranslations('workbench.composer');
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
  const sidebarTransition = usePaneTransition({
    open: sidebarOpen,
    size: layout.sidebarW,
    onSizeChange: syncSidebarPaneSize,
  });
  const rightTransition = usePaneTransition({
    open: rightPanel.open,
    size: layout.rightW,
    onSizeChange: syncRightPaneSize,
  });
  const bottomTransition = usePaneTransition({
    open: bottomPanel.open,
    size: layout.bottomH,
    onSizeChange: syncBottomPaneSize,
  });
  const horizontalAnimating = sidebarTransition.isAnimating || rightTransition.isAnimating;
  const verticalAnimating = bottomTransition.isAnimating;
  const shellAnimating = horizontalAnimating || verticalAnimating;
  // Tab content mounts lazily on the panel's first settled open, so no shell is spawned for a
  // panel that is never shown. Latched during render — React's prescribed state adjustment.
  const [rightContentMounted, setRightContentMounted] = useState(false);
  if (rightTransition.phase === 'open' && !rightContentMounted) setRightContentMounted(true);
  const [bottomContentMounted, setBottomContentMounted] = useState(false);
  if (bottomTransition.phase === 'open' && !bottomContentMounted) setBottomContentMounted(true);

  const hasNativeTrafficLights = desktopPlatform === 'darwin';
  const hasNativeBackdrop = desktopPlatform === 'darwin' || desktopPlatform === 'win32';
  const showWindowControls = desktopPlatform !== 'darwin';
  // The workspace grid cell owns the animated divider, so the aside's own border is off.
  const sidebarClassName = hasNativeBackdrop ? 'border-r-0 bg-sidebar/25' : 'border-r-0 bg-sidebar';
  const expandedPanel = getExpandedPanel(expansionStack, rightPanel.open, bottomPanel.open);
  const chromeSurface = getChromeSurface(expandedPanel);

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
  const hideMainTitle = draft !== null || (active === null ? false : titledSession === null);
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
    openRightFileTab,
    closeRightFileTab,
    setActiveRightFileTab,
    openBrowserUrl,
    openRightTerminalAttachTab,
    resetSidebarSize,
    resetRightPanelSize,
    resetBottomPanelSize,
  } = shellState;

  useDesktopShellShortcuts({
    navigation,
    owner: shellRootRef,
    togglePanel,
    updateSidebarOpen,
  });

  const pickDirectory = useCallback(
    () =>
      systemBridge.fs
        .pickFile({ title: 'Choose working folder', directory: true })
        .then((paths) => paths?.[0] ?? null),
    [systemBridge],
  );

  const pickAttachmentFiles = useCallback(async (): Promise<ComposerAttachment[]> => {
    const paths = await systemBridge.fs.pickFile({
      title: tComposer('attachmentPickerTitle'),
      multiple: true,
      filters: [
        {
          name: tComposer('attachmentPickerFilter'),
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
        },
      ],
    });
    if (!paths || !onReadAttachmentFile) return [];
    return Promise.all(paths.map((path) => onReadAttachmentFile(path)));
  }, [systemBridge, onReadAttachmentFile, tComposer]);

  useDesktopPaletteCommands({
    desktopPlatform,
    pickDirectory,
    onRegisterWorkspace,
    onOpenSettings,
    togglePanel,
    updateSidebarOpen,
  });

  // File-artifact clicks land in the right panel's files section. A bare filename from agent prose
  // may live outside the session cwd, so the locator probes candidate dirs from the tool calls.
  function openFileArtifact(path: string): void {
    const cwd = active?.cwd;
    if (!cwd) {
      if (isAbsoluteFilePath(path)) openRightFileTab(path);
      return;
    }
    void locateFileArtifact(path, cwd, conversation.items).then(openRightFileTab);
  }

  function reviewChanges(): void {
    openRightPanelSection('diff');
  }

  const main = (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div aria-hidden className={`${DESKTOP_CHROME_SPACER_CLASS} shrink-0`} />
      {draft ? (
        // Keyed per entry point so opening from another group resets the page's picks.
        <NewSessionSurface
          key={draft.initialWorkspaceId ?? 'default'}
          className="min-h-0 flex-1"
          draft={draft}
          workspaces={workspaces}
          chatWorkspace={chatWorkspace}
          runtimeCues={runtimeCues}
          attachmentSupport={attachmentSupport}
          topContent={<ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />}
          onContinueUnverified={onContinueUnverified}
          onDownloadAgent={onDownloadAgent}
          onLoginAgent={onLoginAgent}
          onSubmitLoginCode={onSubmitLoginCode}
          onCancelLogin={onCancelLogin}
          onSubmit={onSubmitDraft}
          onPickDirectory={pickDirectory}
          onRegisterWorkspace={onRegisterWorkspace}
          onPickAttachmentFiles={pickAttachmentFiles}
        />
      ) : (
        // Keyed per session: switching resets the composer draft and scroll without touching the shell.
        <ConversationSurface
          key={active?.sessionId ?? 'no-active-session'}
          className="min-h-0 flex-1"
          conversation={conversation}
          agentKind={active?.kind}
          agentLabel={agentLabel}
          attachmentsSupported={Boolean(active && attachmentSupport?.[active.kind])}
          cwd={active?.cwd}
          runtimeCues={runtimeCues}
          onLoginAgent={onLoginAgent}
          onSubmitLoginCode={onSubmitLoginCode}
          onCancelLogin={onCancelLogin}
          respondingRequestIds={respondingRequestIds}
          responseErrors={responseErrors}
          TerminalBlockComponent={TerminalBlockComponent}
          disabled={!active || active.status === 'stopped'}
          isRunning={isRunning}
          mentionItems={mentionItems}
          onMentionQueryChange={onMentionQueryChange}
          onSendPrompt={onSendPrompt}
          onStopTurn={onStopTurn}
          onRespondPermission={onRespondPermission}
          onRespondQuestion={onRespondQuestion}
          onOpenFileArtifact={openFileArtifact}
          onReviewChanges={reviewChanges}
          onHostArtifact={onHostArtifact}
          onOpenPreviewUrl={openBrowserUrl}
          onPickAttachmentFiles={pickAttachmentFiles}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
        />
      )}
    </main>
  );

  // Two mount points per side: the docked instance keeps owning the chrome tabs (the maximized
  // overlay suppresses chrome, so the two never portal duplicate tabs mid-transition), and tab
  // content mounts in exactly one of them via `contentHidden`, so stateful tabs like the terminal
  // never run twice; the terminal session registry hands the PTY across the remount.
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
        terminalContentTargetRef={setRightContentTarget}
        onSelectSection={setActiveSection}
        onSelectTerminalTab={setActiveRightTerminalTab}
        onCloseTerminalTab={closeRightTerminalTab}
        onAddTerminalTab={addRightTerminalTab}
        onSelectFileTab={setActiveRightFileTab}
        onCloseFileTab={closeRightFileTab}
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
        contentTargetRef={setBottomContentTarget}
        onSelectTab={(id) => updatePanel((current) => ({ ...current, activeTabId: id }))}
        onCloseTab={(id) => closeTab(id)}
        onAddWindow={(type) => addWindow(type)}
        onToggleMax={() => toggleMaxPanel('bottom')}
        onClose={() => closePanel('bottom')}
      />
    );
  }

  // The shell owns the Terminal-section PTY stack and portals it into whichever region instance
  // shows content (`contentHidden` guarantees exactly one target), so a terminal keeps its live
  // renderer across the docked↔maximized handoff. Mounts lazily on the panel's first open — no
  // shell spawns for a never-shown panel; Diff/Browser content is stateless and stays inline.
  function renderRightPanelContents(host: HTMLDivElement): React.ReactNode {
    const activeIsTerminal = rightPanel.activeSection === 'terminal';
    const items = rightPanel.terminal.tabs.map((tab) => ({
      id: tab.id,
      active: activeIsTerminal && tab.id === rightPanel.terminal.activeTabId,
      node: tab.id.startsWith('attach:') ? (
        <AttachedTerminalPanel
          terminalId={tab.id.slice('attach:'.length)}
          suspended={rightTransition.phase !== 'open' || shellAnimating}
        />
      ) : (
        <TerminalPanel
          sessionKey={tab.id}
          cwd={active?.cwd}
          suspended={rightTransition.phase !== 'open' || shellAnimating}
        />
      ),
    }));
    // The browser webview lives here permanently: unmounting or DOM-moving a webview
    // reloads it, so section switches only toggle its visibility.
    items.push({
      id: 'browser-resident',
      active: rightPanel.activeSection === 'browser',
      node: <BrowserWebviewPane />,
    });
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
            suspended={bottomTransition.phase !== 'open' || shellAnimating}
          />
        ) : (
          <PanelStubContent type={tab.type} />
        ),
    }));
    return createPortal(<PanelTabContentStack items={items} />, host);
  }

  const workspaceRight: WorkspaceSide = {
    transition: rightTransition,
    open: rightPanel.open,
    node: renderRightPanel({
      maximized: expandedPanel === 'right',
      chromeVisible: rightTransition.paneVisible,
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
    transition: bottomTransition,
    open: bottomPanel.open,
    node: renderBottomPanel({
      maximized: expandedPanel === 'bottom',
      chromeVisible: bottomTransition.paneVisible,
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
      data-shell-horizontal-animating={horizontalAnimating ? '' : undefined}
      data-shell-vertical-animating={verticalAnimating ? '' : undefined}
    >
      <DesktopChrome
        header={header}
        navigation={navigation}
        sidebarOpen={sidebarOpen}
        rightPanelOpen={rightPanel.open}
        bottomPanelOpen={bottomPanel.open}
        expandedPanel={expandedPanel}
        hasNativeBackdrop={hasNativeBackdrop}
        hasNativeTrafficLights={hasNativeTrafficLights}
        showWindowControls={showWindowControls}
        sidebarShortcut={sidebarShortcut}
        rightPanelShortcut={rightPanelShortcut}
        bottomPanelShortcut={bottomPanelShortcut}
        titleContent={
          hideMainTitle ? (
            // An untitled conversation hides the title area, which would also hide the error
            // badge with no banner fallback; keep the badge alone. The draft page stays bare —
            // it reports errors through its own in-page banner.
            draft === null ? (
              <ErrorBadge
                errorMessage={errorMessage}
                onDismissError={onDismissError}
                className="pointer-events-auto [-webkit-app-region:no-drag]"
              />
            ) : null
          ) : undefined
        }
        titleIcon={
          titledSession ? (
            <AgentIcon className="text-foreground" kind={titledSession.kind} variant="ghost" />
          ) : undefined
        }
        titleChip={
          <>
            <WorkspaceServicesMenu
              cwd={active?.cwd}
              onOpenInApp={openBrowserUrl}
              onViewLogs={openRightTerminalAttachTab}
            />
            {titledSession ? (
              <DiffStatChip
                cwd={titledSession.cwd}
                onOpenDiff={() => openRightPanelSection('diff')}
              />
            ) : undefined}
            <ErrorBadge
              errorMessage={errorMessage}
              onDismissError={onDismissError}
              className="pointer-events-auto [-webkit-app-region:no-drag]"
            />
          </>
        }
        onShowSidebar={() => updateSidebarOpen(true)}
        onHideSidebar={() => updateSidebarOpen(false)}
        onToggleRight={() => togglePanel('right')}
        onToggleBottom={() => togglePanel('bottom')}
      >
        <DesktopWorkspace
          main={main}
          right={workspaceRight}
          bottom={workspaceBottom}
          expandedPanel={expandedPanel}
          layout={layout}
          onLayoutChange={updateLayout}
          onSidebarResize={syncSidebarPaneSize}
          onRightResize={syncRightPaneSize}
          onBottomResize={syncBottomPaneSize}
          sidebar={{
            transition: sidebarTransition,
            open: sidebarOpen,
            onResetSize: resetSidebarSize,
            node: (
              <SessionSidebar
                className={sidebarClassName}
                threadGroups={threadGroups}
                workspacesLoading={workspacesLoading}
                sessionsLoading={sessionsLoading}
                activeId={active?.sessionId ?? null}
                pinnedSessionIds={pinnedSessionIds}
                collapsedSections={collapsedSections}
                topInsetClassName={DESKTOP_CHROME_SPACER_CLASS}
                footer={
                  <HostFooter
                    state={tConnection('connected')}
                    appVersion={appVersion}
                    pendingPermissionCount={conversation.pendingPermissionIds.length}
                    account={cloudAuth.account}
                    authPending={cloudAuth.authenticating}
                    onSignIn={cloudAuth.signIn}
                    onSignOut={cloudAuth.signOut}
                    onManageAccount={cloudAuth.manageAccount}
                    remoteHosts={remoteHostItems}
                    remoteHostsLoading={remoteHosts.isLoading}
                    selectedHostId={selectedHostId}
                    onSelectHost={selectHost}
                    onOpenSettings={onOpenSettings}
                  />
                }
                onPickDirectory={pickDirectory}
                onOpenSearch={onOpenSearch}
                onOpenAutomations={onOpenAutomations}
                searchShortcut={searchShortcut}
                onRegisterWorkspace={onRegisterWorkspace}
                onImportHistory={onImportHistory}
                onRenameWorkspace={onRenameWorkspace}
                onArchiveWorkspace={onArchiveWorkspace}
                onToggleGroupCollapsed={onToggleGroupCollapsed}
                onToggleSectionCollapsed={onToggleSectionCollapsed}
                onTogglePreviewExpanded={onTogglePreviewExpanded}
                BranchStatusComponent={BranchStatusComponent}
                // Cloud-gated: without a session the IM source can't authenticate, so the
                // row menu (and its ellipsis) stays hidden entirely.
                ImMenuComponent={cloudAuth.account ? DesktopThreadImMenu : undefined}
                onSelect={onSelectSession}
                onClose={onCloseSession}
                onToggleSessionPinned={onToggleSessionPinned}
                onReorderGroups={onReorderGroups}
                onReorderThreads={onReorderThreads}
                onStartDraft={onStartDraft}
              />
            ),
          }}
        />
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
