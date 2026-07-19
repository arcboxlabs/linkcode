import { WorkspaceIdSchema } from '@linkcode/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'linkcode.workbench.new-session-defaults:v3';
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
  it('keeps successful model and effort choices isolated per provider', async () => {
    const store = await loadStore();

    store
      .getState()
      .remember('claude-code', WORKSPACE_ID, { model: 'claude-opus-4-8', effort: 'high' });
    store.getState().rememberSelection('claude-code', { effort: 'medium' });
    store.getState().rememberSelection('codex', { model: 'gpt-5.6-terra', effort: 'low' });

    expect(store.getState().modelsByProvider).toEqual({
      'claude-code': 'claude-opus-4-8',
      codex: 'gpt-5.6-terra',
    });
    expect(store.getState().effortsByProvider).toEqual({ 'claude-code': 'medium', codex: 'low' });
  });

  it('clears an explicitly rejected selection without disturbing the other axis', async () => {
    const store = await loadStore();
    store
      .getState()
      .remember('claude-code', WORKSPACE_ID, { model: 'claude-opus-4-8', effort: 'ultracode' });

    store.getState().remember('claude-code', WORKSPACE_ID, { effort: null });

    expect(store.getState().modelsByProvider).toEqual({ 'claude-code': 'claude-opus-4-8' });
    expect(store.getState().effortsByProvider).toEqual({});
  });

  it('rehydrates model and effort choices after a renderer restart', async () => {
    const first = await loadStore();
    first.getState().remember('grok-build', WORKSPACE_ID, { model: 'grok-4.5', effort: 'medium' });

    const restarted = await loadStore();

    expect(restarted.getState().modelsByProvider).toEqual({ 'grok-build': 'grok-4.5' });
    expect(restarted.getState().effortsByProvider).toEqual({ 'grok-build': 'medium' });
  });

  it('discards malformed persisted selections at the schema boundary', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          lastProvider: 'codex',
          lastWorkspaceId: WORKSPACE_ID,
          modelsByProvider: { codex: '' },
          effortsByProvider: { codex: 'unsupported' },
        },
        version: 0,
      }),
    );

    const store = await loadStore();

    expect(store.getState().lastProvider).toBeNull();
    expect(store.getState().modelsByProvider).toEqual({});
    expect(store.getState().effortsByProvider).toEqual({});
  });
});
