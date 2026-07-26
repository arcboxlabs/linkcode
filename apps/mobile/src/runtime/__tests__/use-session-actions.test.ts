// @vitest-environment jsdom

import type { LinkCodeClient } from '@linkcode/client-core';
import { LinkCodeProvider } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionActions } from '../use-session-actions';
import { stubClient } from './stub-client';

type Ack = Awaited<ReturnType<LinkCodeClient['promptText']>>;

const SESSION_ID = 'session-1' as SessionId;

const promptText = vi.fn<LinkCodeClient['promptText']>();
const cancel = vi.fn<LinkCodeClient['cancel']>();
const respondPermission = vi.fn<LinkCodeClient['respondPermission']>();
const respondQuestion = vi.fn<LinkCodeClient['respondQuestion']>();

const client = stubClient({ promptText, cancel, respondPermission, respondQuestion });

function render(sessionId: SessionId | null = SESSION_ID) {
  return renderHook(() => useSessionActions(sessionId, 'idle'), {
    wrapper: ({ children }) => createElement(LinkCodeProvider, { client }, children),
  });
}

/** An ack the test settles by hand, so in-flight state stays observable. */
const pending = () => Promise.withResolvers<Ack>();

beforeEach(() => {
  vi.resetAllMocks();
});

describe('useSessionActions', () => {
  it('makes every action a no-op without a session', () => {
    const { result } = render(null);

    act(() => {
      result.current.send('hi');
      result.current.stop();
      result.current.respondPermission('req-1', { outcome: 'cancelled' });
      result.current.respondQuestion('req-1', { outcome: 'cancelled' });
    });

    expect(promptText).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(respondPermission).not.toHaveBeenCalled();
    expect(respondQuestion).not.toHaveBeenCalled();
    expect(result.current.canCompose).toBe(false);
    expect(result.current.respondingIds.size).toBe(0);
  });

  it('tracks a response as in flight until it settles', async () => {
    const ack = pending();
    respondPermission.mockReturnValue(ack.promise);
    const { result } = render();

    act(() => {
      result.current.respondPermission('req-1', { outcome: 'selected', optionId: 'allow' });
    });
    expect(result.current.respondingIds.has('req-1')).toBe(true);

    ack.resolve({ ok: true });
    await waitFor(() => {
      expect(result.current.respondingIds.has('req-1')).toBe(false);
    });
    expect(result.current.failedResponseIds.has('req-1')).toBe(false);
  });

  it('records a failed response and clears it when the same ask is retried', async () => {
    const failed = pending();
    respondQuestion.mockReturnValueOnce(failed.promise);
    const { result } = render();

    act(() => {
      result.current.respondQuestion('req-1', { outcome: 'cancelled' });
    });
    failed.reject(new Error('nope'));
    await waitFor(() => {
      expect(result.current.failedResponseIds.has('req-1')).toBe(true);
    });
    expect(result.current.respondingIds.has('req-1')).toBe(false);

    respondQuestion.mockReturnValueOnce(pending().promise);
    act(() => {
      result.current.respondQuestion('req-1', { outcome: 'cancelled' });
    });
    expect(result.current.failedResponseIds.has('req-1')).toBe(false);
    expect(result.current.respondingIds.has('req-1')).toBe(true);
  });

  it('surfaces which action failed, and a later send clears the stale failure', async () => {
    const stopAck = pending();
    cancel.mockReturnValue(stopAck.promise);
    const { result } = render();

    act(() => {
      result.current.stop();
    });
    stopAck.reject(new Error('nope'));
    await waitFor(() => {
      expect(result.current.failure).toBe('stop');
    });

    promptText.mockReturnValue(pending().promise);
    act(() => {
      result.current.send('hi');
    });
    expect(result.current.failure).toBeNull();
  });
});
