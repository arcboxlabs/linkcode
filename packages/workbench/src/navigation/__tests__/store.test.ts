import type { SessionId } from '@linkcode/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionSelectionStore } from '../../surface/selection-store';
import type { NavLocation } from '../history';
import { useNavigationHistoryStore } from '../store';

function sid(id: string): SessionId {
  return id as SessionId;
}

function thread(id: string): NavLocation {
  return { surface: 'thread', sessionId: sid(id) };
}

const SETTINGS: NavLocation = { surface: 'settings' };

beforeEach(() => {
  useNavigationHistoryStore.setState({ back: [], forward: [], overlay: null });
  useSessionSelectionStore.setState({ selectedId: null });
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

describe('backFromOverlay', () => {
  it('applies a thread target to the selection store and pushes the overlay onto forward', () => {
    useNavigationHistoryStore.setState({ back: [thread('a')], overlay: 'settings' });
    useSessionSelectionStore.getState().setSelectedId(sid('b'));

    useNavigationHistoryStore.getState().backFromOverlay();

    expect(useSessionSelectionStore.getState().selectedId).toBe(sid('a'));
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

  it('closes without touching selection for a draft target', () => {
    useNavigationHistoryStore.setState({
      back: [{ surface: 'new-thread', workspaceId: null }],
      overlay: 'settings',
    });

    useNavigationHistoryStore.getState().backFromOverlay();

    expect(useSessionSelectionStore.getState().selectedId).toBeNull();
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
