import type { DesktopShellState } from '@renderer/shell/store/model';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  createPanelState,
  DEFAULT_LAYOUT,
  parsePersistedDesktopShellState,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  serializeDesktopShellState,
} from '@renderer/shell/store/model';
import { describe, expect, it } from 'vitest';

describe('desktop shell state persistence', () => {
  it('requires the persisted version marker', () => {
    const state = parsePersistedDesktopShellState({
      sidebarOpen: false,
      rightPanel: { open: true, tabs: ['browser'], activeTabIndex: 0 },
      bottomPanel: { open: true, tabs: ['files'], activeTabIndex: 0 },
    });

    expect(state.sidebarOpen).toBe(true);
    expect(state.expansionStack).toEqual([]);
    expect(panelTypes(state.rightPanel)).toEqual(['review']);
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
  });

  it('clamps latest layout values', () => {
    const state = parsePersistedDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: { sidebarW: 10, rightW: 10000, bottomH: 1 },
      expansionStack: [],
      rightPanel: { open: false, tabs: ['review'], activeTabIndex: 0 },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.layout).toEqual({
      sidebarW: SIDEBAR_MIN_SIZE,
      rightW: RIGHT_PANEL_MAX_SIZE,
      bottomH: BOTTOM_PANEL_MIN_SIZE,
    });
  });

  it('rejects invalid panel tabs and falls back when none remain', () => {
    const state = parsePersistedDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: {
        sidebarW: SIDEBAR_MAX_SIZE,
        rightW: RIGHT_PANEL_MIN_SIZE,
        bottomH: BOTTOM_PANEL_MAX_SIZE,
      },
      expansionStack: [],
      rightPanel: { open: true, tabs: ['review', 'invalid', 'browser'], activeTabIndex: 9 },
      bottomPanel: { open: true, tabs: ['invalid'], activeTabIndex: 0 },
    });

    expect(panelTypes(state.rightPanel)).toEqual(['review', 'browser']);
    expect(activePanelType(state, 'rightPanel')).toBe('browser');
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
    expect(activePanelType(state, 'bottomPanel')).toBe('terminal');
  });

  it('clamps active indexes below bounds', () => {
    const state = parsePersistedDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: { open: true, tabs: ['files', 'browser'], activeTabIndex: -4 },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(activePanelType(state, 'rightPanel')).toBe('files');
  });

  it('filters expansion stack to open panels', () => {
    const state = parsePersistedDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: ['right', 'bottom', 'bottom', 'invalid'],
      rightPanel: { open: false, tabs: ['review'], activeTabIndex: 0 },
      bottomPanel: { open: true, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(state.expansionStack).toEqual(['bottom']);
  });

  it('round trips the latest serialized shape', () => {
    const source: DesktopShellState = {
      sidebarOpen: false,
      layout: { sidebarW: 300, rightW: 500, bottomH: 260 },
      expansionStack: ['right', 'bottom'],
      rightPanel: createPanelState(true, 'browser'),
      bottomPanel: createPanelState(true, 'files'),
    };

    const parsed = parsePersistedDesktopShellState(serializeDesktopShellState(source));

    expect(parsed.sidebarOpen).toBe(false);
    expect(parsed.layout).toEqual(source.layout);
    expect(parsed.expansionStack).toEqual(['right', 'bottom']);
    expect(panelTypes(parsed.rightPanel)).toEqual(['browser']);
    expect(panelTypes(parsed.bottomPanel)).toEqual(['files']);
  });
});

function panelTypes(panel: DesktopShellState['rightPanel']): string[] {
  return panel.tabs.map((tab) => tab.type);
}

function activePanelType(
  state: DesktopShellState,
  side: 'rightPanel' | 'bottomPanel',
): string | undefined {
  const panel = state[side];
  return panel.tabs.find((tab) => tab.id === panel.activeTabId)?.type;
}
