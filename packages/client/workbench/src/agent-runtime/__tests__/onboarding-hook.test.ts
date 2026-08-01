// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { nullthrow } from 'foxact/nullthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentRuntimeOnboarding } from '../onboarding';

interface LoginHandlers {
  onUrl: (url: string) => void;
  onSettled: (result: { ok: boolean; error?: string }) => void;
}

const mocks = vi.hoisted(() => ({
  client: {
    subscribeAssetProgress: vi.fn(() => vi.fn()),
    subscribeAssetSettled: vi.fn(() => vi.fn()),
    subscribeAgentRuntimesChanged: vi.fn(() => vi.fn()),
    startAgentLogin: vi.fn(),
    subscribeAgentLogin: vi.fn(),
    submitLoginCode: vi.fn(),
    cancelAgentLogin: vi.fn(),
  },
  runtimes: {},
  ensureAsset: vi.fn(),
  acknowledge: vi.fn(),
}));

vi.mock('@linkcode/client-core', () => ({
  useLinkCodeClient: () => mocks.client,
}));

vi.mock('../../assets/hooks', () => ({
  useAssets: () => ({ data: [] }),
}));

vi.mock('../hooks', () => ({
  useAgentRuntimes: () => ({ data: mocks.runtimes }),
}));

vi.mock('../../runtime/tayori', () => ({
  useData: (operation: { name: string }) => ({
    data: operation.name === 'getAccounts' ? [] : {},
  }),
  useMutation: () => ({ trigger: mocks.ensureAsset }),
}));

vi.mock('../unverified-store', () => ({
  useUnverifiedRuntimesStore: (
    selector: (state: {
      acknowledged: Record<string, string>;
      acknowledge: (kind: string, version: string) => void;
    }) => unknown,
  ) => selector({ acknowledged: {}, acknowledge: mocks.acknowledge }),
}));

let loginHandlers: LoginHandlers | undefined;

function handlers(): LoginHandlers {
  return nullthrow(loginHandlers, 'login handlers were not registered');
}

const ignoreLoginId = (_loginId: string): void => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  loginHandlers = undefined;
  mocks.runtimes = {
    'claude-code': {
      status: 'available',
      source: 'detected',
      auth: { loggedIn: false },
    },
    codex: { status: 'available', source: 'detected', auth: { loggedIn: false } },
  };
  mocks.client.startAgentLogin.mockResolvedValue('login-1');
  mocks.client.subscribeAgentLogin.mockImplementation((_loginId: string, next: LoginHandlers) => {
    loginHandlers = next;
    return vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAgentRuntimeOnboarding login lifecycle', () => {
  it('opens the Codex authorization URL and calls success only after login settles', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAgentRuntimeOnboarding());

    act(() => result.current.login('codex', onSuccess));
    await waitFor(() =>
      expect(mocks.client.subscribeAgentLogin).toHaveBeenCalledWith('login-1', expect.any(Object)),
    );

    act(() => handlers().onUrl('https://auth.openai.test/authorize'));
    expect(open).toHaveBeenCalledWith(
      'https://auth.openai.test/authorize',
      '_blank',
      'noopener,noreferrer',
    );
    expect(result.current.cues.codex).toEqual({
      state: 'needs-login',
      phase: 'awaiting-code',
      url: 'https://auth.openai.test/authorize',
    });
    expect(onSuccess).not.toHaveBeenCalled();

    act(() => handlers().onSettled({ ok: true }));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps Claude on its self-opened browser flow and forwards the pasted code', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { result } = renderHook(() => useAgentRuntimeOnboarding());

    act(() => result.current.login('claude-code'));
    await waitFor(() => expect(mocks.client.subscribeAgentLogin).toHaveBeenCalled());
    act(() => handlers().onUrl('https://claude.ai/oauth/authorize'));

    expect(open).not.toHaveBeenCalled();
    act(() => result.current.submitLoginCode('claude-code', 'authorization-code'));
    expect(mocks.client.submitLoginCode).toHaveBeenCalledWith('login-1', 'authorization-code');
  });

  it('does not call success after failure or cancellation', async () => {
    const onFailureSuccess = vi.fn();
    const first = renderHook(() => useAgentRuntimeOnboarding());
    act(() => first.result.current.login('codex', onFailureSuccess));
    await waitFor(() => expect(mocks.client.subscribeAgentLogin).toHaveBeenCalled());
    act(() => handlers().onSettled({ ok: false, error: 'denied' }));
    expect(onFailureSuccess).not.toHaveBeenCalled();
    expect(first.result.current.cues.codex).toEqual({
      state: 'needs-login',
      phase: 'failed',
      error: 'denied',
    });
    first.unmount();

    let resolveStart = ignoreLoginId;
    const pendingStart = new Promise<string>((resolve) => {
      resolveStart = resolve;
    });
    mocks.client.startAgentLogin.mockReturnValue(pendingStart);
    const onCancelledSuccess = vi.fn();
    const second = renderHook(() => useAgentRuntimeOnboarding());
    act(() => second.result.current.login('claude-code', onCancelledSuccess));
    act(() => second.result.current.cancelLogin('claude-code'));
    await act(async () => {
      resolveStart('login-2');
      await pendingStart;
    });

    expect(mocks.client.cancelAgentLogin).toHaveBeenCalledWith('login-2');
    act(() => handlers().onSettled({ ok: true }));
    expect(onCancelledSuccess).not.toHaveBeenCalled();
  });
});
