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
  useNavigationHistoryStore.setState({ back: [], forward: [], settingsOpen: false });
  useSessionSelectionStore.setState({ selectedId: null });
});

describe('openSettings', () => {
  it('records the explicit selection as the origin and raises the overlay', () => {
    useSessionSelectionStore.getState().setSelectedId(sid('a'));
    useNavigationHistoryStore.getState().openSettings();

    const state = useNavigationHistoryStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.back).toEqual([thread('a')]);
    expect(state.forward).toEqual([]);
  });

  it('records no origin without a selection', () => {
    useNavigationHistoryStore.getState().openSettings();

    const state = useNavigationHistoryStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.back).toEqual([]);
  });

  it('is a no-op while already open', () => {
    useSessionSelectionStore.getState().setSelectedId(sid('a'));
    useNavigationHistoryStore.getState().openSettings();
    useNavigationHistoryStore.getState().openSettings();

    expect(useNavigationHistoryStore.getState().back).toEqual([thread('a')]);
  });
});

describe('backFromSettings', () => {
  it('applies a thread target to the selection store and pushes settings onto forward', () => {
    useNavigationHistoryStore.setState({ back: [thread('a')], settingsOpen: true });
    useSessionSelectionStore.getState().setSelectedId(sid('b'));

    useNavigationHistoryStore.getState().backFromSettings();

    expect(useSessionSelectionStore.getState().selectedId).toBe(sid('a'));
    const state = useNavigationHistoryStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.back).toEqual([]);
    expect(state.forward).toEqual([SETTINGS]);
  });

  it('closes without a forward entry when the back stack is empty', () => {
    useNavigationHistoryStore.setState({ settingsOpen: true });

    useNavigationHistoryStore.getState().backFromSettings();

    const state = useNavigationHistoryStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.forward).toEqual([]);
  });

  it('closes without touching selection for a draft target', () => {
    useNavigationHistoryStore.setState({
      back: [{ surface: 'new-thread', workspaceId: null }],
      settingsOpen: true,
    });

    useNavigationHistoryStore.getState().backFromSettings();

    expect(useSessionSelectionStore.getState().selectedId).toBeNull();
    const state = useNavigationHistoryStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.forward).toEqual([SETTINGS]);
  });

  it('is a no-op while settings is closed', () => {
    useNavigationHistoryStore.setState({ back: [thread('a')] });

    useNavigationHistoryStore.getState().backFromSettings();

    expect(useNavigationHistoryStore.getState().back).toEqual([thread('a')]);
  });
});
