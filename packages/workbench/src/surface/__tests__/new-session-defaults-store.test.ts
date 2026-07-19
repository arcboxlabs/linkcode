import { WorkspaceIdSchema } from '@linkcode/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'linkcode.workbench.new-session-defaults:v2';
const WORKSPACE_ID = WorkspaceIdSchema.parse('workspace-1');
const stored = new Map<string, string>();
const storage = {
  clear: () => stored.clear(),
  getItem: (key: string) => stored.get(key) ?? null,
  removeItem(key: string) {
    stored.delete(key);
  },
  setItem(key: string, value: string) {
    stored.set(key, value);
  },
};

async function loadStore() {
  vi.resetModules();
  return (await import('../new-session-defaults-store')).useNewSessionDefaultsStore;
}

beforeAll(() => vi.stubGlobal('localStorage', storage));
beforeEach(() => storage.clear());
afterAll(() => vi.unstubAllGlobals());

describe('new-session effort defaults', () => {
  it('keeps successful effort choices isolated per provider', async () => {
    const store = await loadStore();

    store.getState().remember('claude-code', WORKSPACE_ID, 'high');
    store.getState().rememberEffort('codex', 'low');

    expect(store.getState().effortsByProvider).toEqual({ 'claude-code': 'high', codex: 'low' });
  });

  it('rehydrates effort choices after a renderer restart', async () => {
    const first = await loadStore();
    first.getState().remember('grok-build', WORKSPACE_ID, 'medium');

    const restarted = await loadStore();

    expect(restarted.getState().effortsByProvider).toEqual({ 'grok-build': 'medium' });
  });

  it('discards malformed persisted effort values at the schema boundary', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          lastProvider: 'codex',
          lastWorkspaceId: WORKSPACE_ID,
          effortsByProvider: { codex: 'unsupported' },
        },
        version: 0,
      }),
    );

    const store = await loadStore();

    expect(store.getState().lastProvider).toBeNull();
    expect(store.getState().effortsByProvider).toEqual({});
  });
});
