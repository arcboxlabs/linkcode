import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'linkcode.workbench.resources-panel:v1';
const stored = new Map<string, string>();
const storage = {
  clear: () => stored.clear(),
  getItem: (key: string) => stored.get(key) ?? null,
  removeItem: (key: string) => stored.delete(key),
  setItem: (key: string, value: string) => stored.set(key, value),
};

async function loadStore() {
  vi.resetModules();
  return (await import('../resources-panel-store')).useResourcesPanelStore;
}

beforeAll(() => vi.stubGlobal('localStorage', storage));
beforeEach(() => storage.clear());
afterAll(() => vi.unstubAllGlobals());

describe('resources panel visibility', () => {
  it('selects an inline surface only when right-side space is available', async () => {
    const { getResourcesPanelPresentation } = await import('../resources-panel-store');

    expect(
      getResourcesPanelPresentation({ available: false, wide: true, rightPanelOpen: false }),
    ).toBe('hidden');
    expect(
      getResourcesPanelPresentation({ available: true, wide: true, rightPanelOpen: false }),
    ).toBe('inline');
    expect(
      getResourcesPanelPresentation({ available: true, wide: false, rightPanelOpen: false }),
    ).toBe('popover');
    expect(
      getResourcesPanelPresentation({ available: true, wide: true, rightPanelOpen: true }),
    ).toBe('popover');
  });

  it('roundtrips open state', async () => {
    const first = await loadStore();
    first.getState().setOpen(true);

    const restarted = await loadStore();
    expect(restarted.getState().open).toBe(true);
  });

  it('discards malformed persisted state', async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ state: { open: 'yes' }, version: 0 }));

    const store = await loadStore();
    expect(store.getState().open).toBe(false);
  });
});
