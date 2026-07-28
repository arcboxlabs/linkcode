import type { SessionId } from '@linkcode/schema';
import { trueFn } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionSelectionStore } from '../../surface/selection-store';
import type { NavLocation } from '../history';
import { installNavigationPerformanceObserver, useNavigationHistoryStore } from '../store';

function sid(id: string): SessionId {
  return id as SessionId;
}

function thread(id: string): NavLocation {
  return { surface: 'thread', sessionId: sid(id) };
}

const SETTINGS: NavLocation = { surface: 'settings' };

beforeEach(() => {
  useNavigationHistoryStore.setState({ back: [], forward: [], overlay: null });
  useSessionSelectionStore.setState({ selectedId: null, draft: null });
});

describe('openOverlay', () => {
  it('records the explicit selection as the origin and raises the overlay', () => {
    useSessionSelectionStore.getState().setSelectedId(sid('a'));
    useNavigationHistoryStore.getState().openOverlay('settings');

    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBe('settings');
    expect(state.back).toEqual([thread('a')]);
    expect(state.forward).toEqual([]);
  });

  it('records the open draft as the origin, winning over the selection', () => {
    useSessionSelectionStore.setState({ selectedId: sid('a'), draft: { workspaceId: null } });
    useNavigationHistoryStore.getState().openOverlay('settings');

    expect(useNavigationHistoryStore.getState().back).toEqual([
      { surface: 'new-thread', workspaceId: null },
    ]);
  });

  it('records no origin without a selection', () => {
    useNavigationHistoryStore.getState().openOverlay('settings');

    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBe('settings');
    expect(state.back).toEqual([]);
  });

  it('is a no-op while the same surface is already up', () => {
    useSessionSelectionStore.getState().setSelectedId(sid('a'));
    useNavigationHistoryStore.getState().openOverlay('settings');
    useNavigationHistoryStore.getState().openOverlay('settings');

    expect(useNavigationHistoryStore.getState().back).toEqual([thread('a')]);
  });
});

describe('navigation performance observer', () => {
  it('reports only the bounded destination surface for forward and history navigation', () => {
    const observer = vi.fn();
    const uninstall = installNavigationPerformanceObserver(observer);

    useNavigationHistoryStore.getState().record(null, thread('private-session-id'));
    useNavigationHistoryStore.setState({ back: [SETTINGS] });
    useNavigationHistoryStore.getState().travel('back', thread('private-session-id'), trueFn);
    uninstall();

    expect(observer.mock.calls).toEqual([['thread'], ['settings']]);
  });
});

describe('backFromOverlay', () => {
  it('applies a thread target to the selection store and pushes the overlay onto forward', () => {
    useNavigationHistoryStore.setState({ back: [thread('a')], overlay: 'settings' });
    useSessionSelectionStore.setState({ selectedId: sid('b'), draft: { workspaceId: null } });

    useNavigationHistoryStore.getState().backFromOverlay();

    expect(useSessionSelectionStore.getState().selectedId).toBe(sid('a'));
    // A thread target must also clear the draft, or the draft page wins the derivation.
    expect(useSessionSelectionStore.getState().draft).toBeNull();
    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBeNull();
    expect(state.back).toEqual([]);
    expect(state.forward).toEqual([SETTINGS]);
  });

  it('re-raises a popped overlay surface instead of closing', () => {
    useNavigationHistoryStore.setState({ back: [SETTINGS], overlay: 'settings' });

    useNavigationHistoryStore.getState().backFromOverlay();

    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBe('settings');
    expect(state.back).toEqual([]);
    expect(state.forward).toEqual([SETTINGS]);
  });

  it('closes without a forward entry when the back stack is empty', () => {
    useNavigationHistoryStore.setState({ overlay: 'settings' });

    useNavigationHistoryStore.getState().backFromOverlay();

    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBeNull();
    expect(state.forward).toEqual([]);
  });

  it('applies a draft target through the selection store without touching the selection', () => {
    useNavigationHistoryStore.setState({
      back: [{ surface: 'new-thread', workspaceId: null }],
      overlay: 'settings',
    });
    useSessionSelectionStore.getState().setSelectedId(sid('b'));

    useNavigationHistoryStore.getState().backFromOverlay();

    expect(useSessionSelectionStore.getState().selectedId).toBe(sid('b'));
    expect(useSessionSelectionStore.getState().draft).toEqual({ workspaceId: null });
    const state = useNavigationHistoryStore.getState();
    expect(state.overlay).toBeNull();
    expect(state.forward).toEqual([SETTINGS]);
  });

  it('is a no-op while no overlay is up', () => {
    useNavigationHistoryStore.setState({ back: [thread('a')] });

    useNavigationHistoryStore.getState().backFromOverlay();

    expect(useNavigationHistoryStore.getState().back).toEqual([thread('a')]);
  });
});
