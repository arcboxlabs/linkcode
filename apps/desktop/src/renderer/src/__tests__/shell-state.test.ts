import type { DesktopShellState, RightPanelState } from '@renderer/shell/store/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  closeSectionTabState,
  createDefaultDesktopShellState,
  createDefaultRightPanelState,
  createPanelState,
  createRightFileTab,
  DEFAULT_LAYOUT,
  openFileTabState,
  parsePersistedDesktopShellState,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  revealSectionState,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  serializeDesktopShellState,
} from '@renderer/shell/store/model';
import { describe, expect, it } from 'vitest';

describe('desktop shell state persistence', () => {
  it('falls back to defaults when the version marker is missing', () => {
    const state = parsePersistedDesktopShellState({
      sidebarOpen: false,
      rightPanel: {
        open: true,
        activeSection: 'terminal',
        terminalTabCount: 2,
        activeTerminalTabIndex: 1,
      },
      bottomPanel: { open: true, tabs: ['files'], activeTabIndex: 0 },
    });

    expect(state.sidebarOpen).toBe(true);
    expect(state.expansionStack).toEqual([]);
    expect(state.rightPanel).toEqual(createDefaultRightPanelState());
    expect(panelTypes(state.bottomPanel)).toEqual([]);
  });

  it('falls back to defaults for a stale v1 payload instead of migrating it', () => {
    const state = parsePersistedDesktopShellState({
      version: 1,
      sidebarOpen: false,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: { open: true, tabs: ['review'], activeTabIndex: 0 },
      bottomPanel: { open: true, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.sidebarOpen).toBe(true);
    expect(state.expansionStack).toEqual([]);
    expect(state.rightPanel).toEqual(createDefaultRightPanelState());
    expect(panelTypes(state.bottomPanel)).toEqual([]);
  });

  it('clamps latest layout values', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: { sidebarW: 10, rightW: 10000, bottomH: 1 },
      expansionStack: [],
      rightPanel: {
        open: false,
        activeSection: 'diff',
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.layout).toEqual({
      sidebarW: SIDEBAR_MIN_SIZE,
      rightW: RIGHT_PANEL_MAX_SIZE,
      bottomH: BOTTOM_PANEL_MIN_SIZE,
    });
  });

  it('rejects invalid bottom tabs and falls back when none remain', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: {
        sidebarW: SIDEBAR_MAX_SIZE,
        rightW: RIGHT_PANEL_MIN_SIZE,
        bottomH: BOTTOM_PANEL_MAX_SIZE,
      },
      expansionStack: [],
      rightPanel: {
        open: false,
        activeSection: 'diff',
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: true, tabs: ['invalid'], activeTabIndex: 0 },
    });

    expect(panelTypes(state.bottomPanel)).toEqual([]);
    expect(activeBottomPanelType(state)).toBeUndefined();
  });

  it('rejects an invalid right panel section and falls back to diff', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'invalid',
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.rightPanel.activeSection).toBe('diff');
  });

  it('filters expansion stack to open panels', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: ['right', 'bottom', 'bottom', 'invalid'],
      rightPanel: {
        open: false,
        activeSection: 'diff',
      },
      bottomPanel: { open: true, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.expansionStack).toEqual(['bottom']);
  });

  it('round trips the latest serialized shape', () => {
    const fileTab = createRightFileTab('/w/PLAN.md');
    const rightPanel: RightPanelState = {
      open: true,
      activeSection: 'browser',
      files: { tabs: [fileTab, createRightFileTab('/w/report.pdf')], activeTabId: fileTab.id },
      browser: { url: 'http://web--app-1a2b3c.localhost:19523' },
    };
    const source: DesktopShellState = {
      sidebarOpen: false,
      layout: { sidebarW: 300, rightW: 500, bottomH: 260 },
      expansionStack: ['right', 'bottom'],
      rightPanel,
      bottomPanel: createPanelState(true, 'files'),
    };

    const parsed = parsePersistedDesktopShellState(serializeDesktopShellState(source));

    expect(parsed.sidebarOpen).toBe(false);
    expect(parsed.layout).toEqual(source.layout);
    expect(parsed.expansionStack).toEqual(['right', 'bottom']);
    expect(parsed.rightPanel.activeSection).toBe('browser');
    expect(parsed.rightPanel.files.tabs.map((tab) => tab.path)).toEqual([
      '/w/PLAN.md',
      '/w/report.pdf',
    ]);
    expect(parsed.rightPanel.files.activeTabId).toBe(parsed.rightPanel.files.tabs[0].id);
    expect(parsed.rightPanel.browser.url).toBe('http://web--app-1a2b3c.localhost:19523');
    expect(panelTypes(parsed.bottomPanel)).toEqual(['files']);
  });

  it('round trips a shared terminal as the active bottom tab beside non-terminal tabs', () => {
    const source = createDefaultDesktopShellState();
    source.bottomPanel = { ...createPanelState(true, 'files'), activeTabId: null };

    const parsed = parsePersistedDesktopShellState(serializeDesktopShellState(source));

    expect(panelTypes(parsed.bottomPanel)).toEqual(['files']);
    expect(parsed.bottomPanel.activeTabId).toBeNull();
  });

  it('drops renderer-scoped blob URLs from persisted browser state', () => {
    const source = createDefaultDesktopShellState();
    source.rightPanel.browser.url = 'blob:http://localhost:5173/expired-preview';

    const serialized = serializeDesktopShellState(source);
    expect(serialized.rightPanel.browserUrl).toBeNull();

    const parsed = parsePersistedDesktopShellState({
      ...serialized,
      rightPanel: {
        ...serialized.rightPanel,
        browserUrl: 'blob:http://localhost:5173/expired-preview',
      },
    });
    expect(parsed.rightPanel.browser.url).toBeNull();
  });
});

describe('closeSectionTabState', () => {
  it('falls back the active tab to the neighbor that slides into its slot', () => {
    const a = createRightFileTab('/a');
    const b = createRightFileTab('/b');
    const c = createRightFileTab('/c');
    const files = { tabs: [a, b, c], activeTabId: b.id };

    const next = closeSectionTabState(files, b.id);

    expect(next.tabs.map((tab) => tab.id)).toEqual([a.id, c.id]);
    expect(next.activeTabId).toBe(c.id);
  });

  it('keeps the active tab untouched when closing an inactive tab', () => {
    const a = createRightFileTab('/a');
    const b = createRightFileTab('/b');
    const files = { tabs: [a, b], activeTabId: a.id };

    const next = closeSectionTabState(files, b.id);

    expect(next.tabs.map((tab) => tab.id)).toEqual([a.id]);
    expect(next.activeTabId).toBe(a.id);
  });

  it('clears the active tab id once the last tab is closed', () => {
    const a = createRightFileTab('/a');
    const files = { tabs: [a], activeTabId: a.id };

    const next = closeSectionTabState(files, a.id);

    expect(next.tabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it('is a no-op when the tab is not found', () => {
    const a = createRightFileTab('/a');
    const files = { tabs: [a], activeTabId: a.id };

    expect(closeSectionTabState(files, 'missing')).toBe(files);
  });
});

describe('revealSectionState', () => {
  it('brings the terminal section forward without owning its tabs', () => {
    const panel = { ...createDefaultRightPanelState(), open: true };

    const revealed = revealSectionState(panel, 'terminal', true);

    expect(revealed.activeSection).toBe('terminal');
    expect(revealed.open).toBe(true);
  });

  it('leaves the terminal section untouched when revealing another section', () => {
    const panel = { ...createDefaultRightPanelState(), open: true };

    const revealed = revealSectionState(panel, 'files', true);

    expect(revealed.activeSection).toBe('files');
  });
});

describe('openFileTabState', () => {
  it('appends and focuses a new tab per distinct path', () => {
    const empty = { tabs: [], activeTabId: null };
    const one = openFileTabState(empty, '/w/PLAN.md');
    expect(one.tabs.map((tab) => tab.path)).toEqual(['/w/PLAN.md']);
    expect(one.activeTabId).toBe(one.tabs[0].id);

    const two = openFileTabState(one, '/w/report.pdf');
    expect(two.tabs).toHaveLength(2);
    expect(two.activeTabId).toBe(two.tabs[1].id);
  });

  it('re-focuses the existing tab instead of duplicating the path', () => {
    const one = openFileTabState({ tabs: [], activeTabId: null }, '/w/PLAN.md');
    const two = openFileTabState(one, '/w/report.pdf');

    const refocused = openFileTabState(two, '/w/PLAN.md');
    expect(refocused.tabs).toHaveLength(2);
    expect(refocused.activeTabId).toBe(two.tabs[0].id);

    // Already active and present: the state is returned untouched.
    expect(openFileTabState(refocused, '/w/PLAN.md')).toBe(refocused);
  });
});

function panelTypes(panel: DesktopShellState['bottomPanel']): string[] {
  return panel.tabs.map((tab) => tab.type);
}

function activeBottomPanelType(state: DesktopShellState): string | undefined {
  const panel = state.bottomPanel;
  return panel.tabs.find((tab) => tab.id === panel.activeTabId)?.type;
}
