import { WorkspaceIdSchema } from '@linkcode/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_SESSION_DEFAULTS_STORAGE_KEY } from '../new-session-defaults-store';

// Imported rather than restated: a hand-copied key drifted once, and the mismatch turned the
// malformed-blob test below into a vacuous pass.
const STORAGE_KEY = NEW_SESSION_DEFAULTS_STORAGE_KEY;
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

describe('new-session defaults', () => {
  it('keeps successful effort choices isolated per provider', async () => {
    const store = await loadStore();

    // A confirmed model rides the same shape but is not stored here — daemon config owns it.
    store
      .getState()
      .remember('claude-code', WORKSPACE_ID, { model: 'claude-opus-4-8', effort: 'high' });
    store.getState().rememberSelection('claude-code', { effort: 'medium' });
    store.getState().rememberSelection('codex', { model: 'gpt-5.6-terra', effort: 'low' });

    expect(store.getState().effortsByProvider).toEqual({ 'claude-code': 'medium', codex: 'low' });
  });

  it('clears an explicitly rejected effort', async () => {
    const store = await loadStore();
    store.getState().remember('claude-code', WORKSPACE_ID, { effort: 'ultracode' });

    store.getState().remember('claude-code', WORKSPACE_ID, { effort: null });

    expect(store.getState().effortsByProvider).toEqual({});
  });

  it('rehydrates effort choices after a renderer restart', async () => {
    const first = await loadStore();
    first.getState().remember('grok-build', WORKSPACE_ID, { effort: 'medium' });

    const restarted = await loadStore();

    expect(restarted.getState().effortsByProvider).toEqual({ 'grok-build': 'medium' });
  });

  it('persists branch choices per workspace and rehydrates them', async () => {
    const otherWorkspaceId = WorkspaceIdSchema.parse('workspace-2');
    const first = await loadStore();
    first.getState().remember('codex', WORKSPACE_ID, {}, { name: 'main', mode: 'local' });
    first.getState().remember('codex', otherWorkspaceId, {}, { name: 'release', mode: 'worktree' });

    const restarted = await loadStore();

    expect(restarted.getState().branchesByWorkspace).toEqual({
      [WORKSPACE_ID]: { name: 'main', mode: 'local' },
      [otherWorkspaceId]: { name: 'release', mode: 'worktree' },
    });
  });

  it('discards malformed persisted selections at the schema boundary', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          lastHarness: 'codex',
          lastWorkspaceId: WORKSPACE_ID,
          effortsByProvider: { codex: 'unsupported' },
        },
        version: 0,
      }),
    );

    const store = await loadStore();

    expect(store.getState().lastHarness).toBeNull();
    expect(store.getState().effortsByProvider).toEqual({});
    expect(store.getState().branchesByWorkspace).toEqual({});
  });
});
