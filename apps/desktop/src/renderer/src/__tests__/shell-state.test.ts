import type { DesktopShellState, RightPanelState } from '@renderer/shell/store/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  closeSectionTabState,
  createDefaultDesktopShellState,
  createDefaultRightPanelState,
  createPanelState,
  createRightFileTab,
  createRightTerminalTab,
  DEFAULT_LAYOUT,
  durableBrowserUrl,
  openFileTabState,
  parsePersistedDesktopShellState,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  revealSectionState,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  seedTerminalSection,
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
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
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
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
  });

  it('falls back to defaults for a stale v2 payload instead of migrating it', () => {
    const state = parsePersistedDesktopShellState({
      version: 2,
      sidebarOpen: false,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'terminal',
        terminalTabCount: 2,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: true, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.sidebarOpen).toBe(true);
    expect(state.expansionStack).toEqual([]);
    expect(state.rightPanel).toEqual(createDefaultRightPanelState());
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
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

    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
    expect(activeBottomPanelType(state)).toBe('terminal');
  });

  it('restores the right panel section and terminal tab count, clamping the active index', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'terminal',
        terminalTabCount: 3,
        activeTerminalTabIndex: 99,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.rightPanel.open).toBe(true);
    expect(state.rightPanel.activeSection).toBe('terminal');
    expect(state.rightPanel.terminal.tabs).toHaveLength(3);
    expect(state.rightPanel.terminal.activeTabId).toBe(state.rightPanel.terminal.tabs[2].id);
  });

  it('seeds a first terminal tab when restoring an open panel showing an empty terminal section', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'terminal',
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.rightPanel.terminal.tabs).toHaveLength(1);
    expect(state.rightPanel.terminal.activeTabId).toBe(state.rightPanel.terminal.tabs[0].id);
  });

  it('does not seed a terminal tab when the restored panel is closed or on another section', () => {
    const closed = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: false,
        activeSection: 'terminal',
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });
    expect(closed.rightPanel.terminal.tabs).toEqual([]);

    const otherSection = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'diff',
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });
    expect(otherSection.rightPanel.terminal.tabs).toEqual([]);
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
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.rightPanel.activeSection).toBe('diff');
  });

  it('falls the active section back to diff when the simulator section lost its membership', () => {
    const payload = {
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'simulator',
        simulatorAdded: false,
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    };

    const dropped = parsePersistedDesktopShellState(payload);
    expect(dropped.rightPanel.activeSection).toBe('diff');
    expect(dropped.rightPanel.simulatorAdded).toBe(false);

    const kept = parsePersistedDesktopShellState({
      ...payload,
      rightPanel: { ...payload.rightPanel, simulatorAdded: true },
    });
    expect(kept.rightPanel.activeSection).toBe('simulator');
    expect(kept.rightPanel.simulatorAdded).toBe(true);
  });

  it('caps a corrupted terminal tab count', () => {
    const state = parsePersistedDesktopShellState({
      version: 3,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: {
        open: true,
        activeSection: 'terminal',
        terminalTabCount: 999,
        activeTerminalTabIndex: 0,
      },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.rightPanel.terminal.tabs.length).toBeLessThanOrEqual(20);
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
        terminalTabCount: 0,
        activeTerminalTabIndex: 0,
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
      simulatorAdded: true,
      terminal: { tabs: [createRightTerminalTab(), createRightTerminalTab()], activeTabId: null },
      files: { tabs: [fileTab, createRightFileTab('/w/report.pdf')], activeTabId: fileTab.id },
      browser: { url: 'https://example.com' },
    };
    const source: DesktopShellState = {
      sidebarOpen: false,
      layout: { sidebarW: 300, rightW: 500, bottomH: 260 },
      expansionStack: ['right', 'bottom'],
      rightPanel: {
        ...rightPanel,
        terminal: { ...rightPanel.terminal, activeTabId: rightPanel.terminal.tabs[1].id },
      },
      bottomPanel: createPanelState(true, 'files'),
    };

    const parsed = parsePersistedDesktopShellState(serializeDesktopShellState(source));

    expect(parsed.sidebarOpen).toBe(false);
    expect(parsed.layout).toEqual(source.layout);
    expect(parsed.expansionStack).toEqual(['right', 'bottom']);
    expect(parsed.rightPanel.activeSection).toBe('browser');
    expect(parsed.rightPanel.simulatorAdded).toBe(true);
    expect(parsed.rightPanel.terminal.tabs).toHaveLength(2);
    expect(parsed.rightPanel.files.tabs.map((tab) => tab.path)).toEqual([
      '/w/PLAN.md',
      '/w/report.pdf',
    ]);
    expect(parsed.rightPanel.files.activeTabId).toBe(parsed.rightPanel.files.tabs[0].id);
    expect(parsed.rightPanel.browser.url).toBe('https://example.com');
    expect(panelTypes(parsed.bottomPanel)).toEqual(['files']);
  });

  it.each([
    'blob:http://localhost:5173/expired-preview',
    'http://file--3e2d018e14777dcb.localhost:19523/',
  ])('drops ephemeral URL %s from persisted browser state', (url) => {
    const source = createDefaultDesktopShellState();
    source.rightPanel.browser.url = url;

    const serialized = serializeDesktopShellState(source);
    expect(serialized.rightPanel.browserUrl).toBeNull();

    const parsed = parsePersistedDesktopShellState({
      ...serialized,
      rightPanel: {
        ...serialized.rightPanel,
        browserUrl: url,
      },
    });
    expect(parsed.rightPanel.browser.url).toBeNull();
  });

  it.each([
    ['blob:http://localhost:5173/expired-preview', null],
    ['http://file--3e2d018e14777dcb.localhost:19523/', null],
    ['http://artifact--turn-123.localhost:19523/', null],
    ['http://web--app-1a2b3c.localhost:19523/', null],
    ['https://example.com/path', 'https://example.com/path'],
  ])('filters durable browser URL %s', (url, expected) => {
    expect(durableBrowserUrl(url)).toBe(expected);
  });
});

describe('closeSectionTabState', () => {
  it('falls back the active tab to the neighbor that slides into its slot', () => {
    const a = createRightTerminalTab();
    const b = createRightTerminalTab();
    const c = createRightTerminalTab();
    const terminal = { tabs: [a, b, c], activeTabId: b.id };

    const next = closeSectionTabState(terminal, b.id);

    expect(next.tabs.map((tab) => tab.id)).toEqual([a.id, c.id]);
    expect(next.activeTabId).toBe(c.id);
  });

  it('keeps the active tab untouched when closing an inactive tab', () => {
    const a = createRightTerminalTab();
    const b = createRightTerminalTab();
    const terminal = { tabs: [a, b], activeTabId: a.id };

    const next = closeSectionTabState(terminal, b.id);

    expect(next.tabs.map((tab) => tab.id)).toEqual([a.id]);
    expect(next.activeTabId).toBe(a.id);
  });

  it('clears the active tab id once the last tab is closed', () => {
    const a = createRightTerminalTab();
    const terminal = { tabs: [a], activeTabId: a.id };

    const next = closeSectionTabState(terminal, a.id);

    expect(next.tabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it('is a no-op when the tab is not found', () => {
    const a = createRightTerminalTab();
    const terminal = { tabs: [a], activeTabId: a.id };

    expect(closeSectionTabState(terminal, 'missing')).toBe(terminal);
  });
});

describe('seedTerminalSection', () => {
  it('seeds and focuses a first tab when the section is empty', () => {
    const seeded = seedTerminalSection({ tabs: [], activeTabId: null });

    expect(seeded.tabs).toHaveLength(1);
    expect(seeded.activeTabId).toBe(seeded.tabs[0].id);
  });

  it('is a no-op when tabs already exist', () => {
    const a = createRightTerminalTab();
    const terminal = { tabs: [a], activeTabId: a.id };

    expect(seedTerminalSection(terminal)).toBe(terminal);
  });
});

describe('revealSectionState', () => {
  it('seeds the terminal section when it comes forward on an open panel', () => {
    const panel = { ...createDefaultRightPanelState(), open: true };

    const revealed = revealSectionState(panel, 'terminal', true);

    expect(revealed.activeSection).toBe('terminal');
    expect(revealed.terminal.tabs).toHaveLength(1);
    expect(revealed.terminal.activeTabId).toBe(revealed.terminal.tabs[0].id);
  });

  it('leaves the terminal section untouched when revealing another section', () => {
    const panel = { ...createDefaultRightPanelState(), open: true };

    const revealed = revealSectionState(panel, 'files', true);

    expect(revealed.activeSection).toBe('files');
    expect(revealed.terminal.tabs).toEqual([]);
  });

  it('adds the simulator section to the strip when revealing it', () => {
    const panel = createDefaultRightPanelState();

    const revealed = revealSectionState(panel, 'simulator', true);

    expect(revealed.activeSection).toBe('simulator');
    expect(revealed.simulatorAdded).toBe(true);
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
