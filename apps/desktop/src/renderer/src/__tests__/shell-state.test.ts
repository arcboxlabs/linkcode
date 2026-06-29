import { describe, expect, it } from 'vitest';
import {
  BOTTOM_PANEL_MAX_SIZE,
  BOTTOM_PANEL_MIN_SIZE,
  DEFAULT_LAYOUT,
  DESKTOP_SHELL_STORAGE_KEY,
  LEGACY_DESKTOP_SHELL_STORAGE_KEY,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  createPanelState,
  parseDesktopShellState,
  readDesktopShellState,
  serializeShellState,
} from '../shell/state/shell-state';
import type { DesktopShellState } from '../shell/state/shell-state';

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#items.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

describe('desktop shell state storage', () => {
  it('falls back for invalid JSON and removes the old storage key', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DESKTOP_SHELL_STORAGE_KEY, JSON.stringify({ maxPanel: 'right' }));
    storage.setItem(DESKTOP_SHELL_STORAGE_KEY, '{');

    const state = readDesktopShellState(storage);

    expect(panelTypes(state.rightPanel)).toEqual(['review']);
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
    expect(state.layout).toEqual(DEFAULT_LAYOUT);
    expect(storage.getItem(LEGACY_DESKTOP_SHELL_STORAGE_KEY)).toBeNull();
  });

  it('ignores old unversioned shapes even when stored under the latest key', () => {
    const state = parseDesktopShellState({
      sidebarOpen: false,
      maxPanel: 'right',
      rightPanel: { open: true, tabs: ['browser'], activeTabIndex: 0 },
      bottomPanel: { open: true, tabs: ['files'], activeTabIndex: 0 },
    });

    expect(state.sidebarOpen).toBe(true);
    expect(state.expansionStack).toEqual([]);
    expect(panelTypes(state.rightPanel)).toEqual(['review']);
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
  });

  it('clamps latest layout values', () => {
    const state = parseDesktopShellState({
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
    const state = parseDesktopShellState({
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
    const state = parseDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      expansionStack: [],
      rightPanel: { open: true, tabs: ['files', 'browser'], activeTabIndex: -4 },
      bottomPanel: { open: false, tabs: ['terminal'], activeTabIndex: 0 },
    });

    expect(activePanelType(state, 'rightPanel')).toBe('files');
  });

  it('filters expansion stack to open panels and ignores legacy maxPanel', () => {
    const state = parseDesktopShellState({
      version: 1,
      sidebarOpen: true,
      layout: DEFAULT_LAYOUT,
      maxPanel: 'right',
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

    const parsed = parseDesktopShellState(serializeShellState(source));

    expect(parsed.sidebarOpen).toBe(false);
    expect(parsed.layout).toEqual(source.layout);
    expect(parsed.expansionStack).toEqual(['right', 'bottom']);
    expect(panelTypes(parsed.rightPanel)).toEqual(['browser']);
    expect(panelTypes(parsed.bottomPanel)).toEqual(['files']);
  });

  it('ignores and removes the old unversioned storage key', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_DESKTOP_SHELL_STORAGE_KEY,
      JSON.stringify({
        sidebarOpen: false,
        maxPanel: 'right',
        rightPanel: { open: true, tabs: ['browser'], activeTabIndex: 0 },
      }),
    );

    const state = readDesktopShellState(storage);

    expect(state.sidebarOpen).toBe(true);
    expect(state.layout).toEqual(DEFAULT_LAYOUT);
    expect(state.rightPanel.open).toBe(false);
    expect(state.bottomPanel.open).toBe(false);
    expect(panelTypes(state.rightPanel)).toEqual(['review']);
    expect(panelTypes(state.bottomPanel)).toEqual(['terminal']);
    expect(storage.getItem(LEGACY_DESKTOP_SHELL_STORAGE_KEY)).toBeNull();
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
