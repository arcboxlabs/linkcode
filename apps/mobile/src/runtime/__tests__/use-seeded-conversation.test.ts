// @vitest-environment jsdom

import type { LinkCodeClient } from '@linkcode/client-core';
import { LinkCodeProvider } from '@linkcode/client-core';
import type { SessionId, SessionInfo } from '@linkcode/schema';
import { renderHook } from '@testing-library/react';
import { noop } from 'foxts/noop';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeededConversation } from '../use-seeded-conversation';
import { stubClient } from './stub-client';

const SESSION_ID = 'session-1' as SessionId;

/** No `historyId`, so the seed read short-circuits and only the announcement is exercised. */
const SESSION: SessionInfo = {
  sessionId: SESSION_ID,
  kind: 'claude-code',
  cwd: '/tmp',
  status: 'idle',
  createdAt: 0,
  updatedAt: 0,
};

const attachSession = vi.fn<LinkCodeClient['attachSession']>();
const detachSession = vi.fn<LinkCodeClient['detachSession']>();

const client = stubClient({
  attachSession,
  detachSession,
  eventSeq: () => 0,
  eventsSnapshot: () => [],
  subscribe: () => noop,
});

function render(session: SessionInfo | null) {
  return renderHook(() => useSeededConversation(session), {
    wrapper: ({ children }) => createElement(LinkCodeProvider, { client }, children),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('useSeededConversation', () => {
  it('announces the session while it is observed and withdraws on teardown', () => {
    const { unmount } = render(SESSION);

    // Under `attached` delivery this announcement is what makes the session's events arrive.
    expect(attachSession).toHaveBeenCalledWith(SESSION_ID);
    expect(detachSession).not.toHaveBeenCalled();

    unmount();

    expect(detachSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('announces nothing when there is no session to observe', () => {
    const { unmount } = render(null);
    unmount();

    expect(attachSession).not.toHaveBeenCalled();
    expect(detachSession).not.toHaveBeenCalled();
  });
});
