// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  removeItem: (key: string) => stored.delete(key),
  setItem: (key: string, value: string) => stored.set(key, value),
};

let createTerminalTab: typeof import('../tabs-store').createTerminalTab;
let useTerminalTabsStore: typeof import('../tabs-store').useTerminalTabsStore;

function useTerminalSurface() {
  return useTerminalTabsStore();
}

describe('shared terminal tabs', () => {
  beforeAll(() => vi.stubGlobal('localStorage', storage));
  beforeEach(async () => {
    stored.clear();
    vi.resetModules();
    ({ createTerminalTab, useTerminalTabsStore } = await import('../tabs-store'));
    const tab = createTerminalTab();
    useTerminalTabsStore.setState({ tabs: [tab], activeTabId: tab.id });
  });

  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  it('synchronizes create, activate, and close operations from both surfaces', () => {
    const right = renderHook(useTerminalSurface);
    const bottom = renderHook(useTerminalSurface);
    const firstId = right.result.current.activeTabId;

    let rightCreated = '';
    act(() => {
      rightCreated = right.result.current.addTab();
    });
    let bottomCreated = '';
    act(() => {
      bottomCreated = bottom.result.current.addTab();
    });

    expect(right.result.current.tabs.map((tab) => tab.id)).toEqual(
      bottom.result.current.tabs.map((tab) => tab.id),
    );
    expect(right.result.current.activeTabId).toBe(bottomCreated);

    act(() => bottom.result.current.setActiveTab(rightCreated));
    expect(right.result.current.activeTabId).toBe(rightCreated);
    expect(bottom.result.current.activeTabId).toBe(rightCreated);

    act(() => right.result.current.closeTab(rightCreated));
    expect(bottom.result.current.tabs.map((tab) => tab.id)).toEqual([firstId, bottomCreated]);
    expect(bottom.result.current.activeTabId).toBe(bottomCreated);

    act(() => bottom.result.current.closeTab(firstId!));
    expect(right.result.current.tabs.map((tab) => tab.id)).toEqual([bottomCreated]);
  });

  it('represents the last-tab state once and can seed it again once', () => {
    const right = renderHook(useTerminalSurface);
    const bottom = renderHook(useTerminalSurface);
    const onlyId = right.result.current.activeTabId!;

    act(() => right.result.current.closeTab(onlyId));
    expect(right.result.current.tabs).toEqual([]);
    expect(bottom.result.current.tabs).toEqual([]);
    expect(right.result.current.activeTabId).toBeNull();

    let seededId = '';
    act(() => {
      seededId = bottom.result.current.ensureTab();
    });
    expect(right.result.current.tabs.map((tab) => tab.id)).toEqual([seededId]);
    expect(bottom.result.current.activeTabId).toBe(seededId);
  });

  it('keeps sessions while either surface unmounts and exposes all independent terminals', () => {
    const right = renderHook(useTerminalSurface);
    const bottom = renderHook(useTerminalSurface);

    let secondId = '';
    let thirdId = '';
    act(() => {
      secondId = right.result.current.addTab();
      thirdId = bottom.result.current.addTab();
    });
    const expectedIds = right.result.current.tabs.map((tab) => tab.id);
    expect(new Set(expectedIds).size).toBe(3);

    right.unmount();
    act(() => bottom.result.current.setActiveTab(secondId));
    expect(bottom.result.current.activeTabId).toBe(secondId);

    const remountedRight = renderHook(useTerminalSurface);
    expect(remountedRight.result.current.tabs.map((tab) => tab.id)).toEqual(expectedIds);
    expect(remountedRight.result.current.activeTabId).toBe(secondId);

    bottom.unmount();
    act(() => remountedRight.result.current.closeTab(secondId));
    expect(remountedRight.result.current.tabs.map((tab) => tab.id)).not.toContain(secondId);
    expect(remountedRight.result.current.tabs.map((tab) => tab.id)).toContain(thirdId);
  });

  it('does not persist attached terminals as reopenable shells', () => {
    const surface = renderHook(useTerminalSurface);
    act(() => surface.result.current.openAttachedTab('script-log'));

    const persisted = JSON.parse(stored.get('linkcode.workbench.terminal-tabs:v1')!);
    expect(persisted.state.tabCount).toBe(1);
  });
});
