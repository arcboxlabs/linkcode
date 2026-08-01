// @vitest-environment jsdom

import type {
  AgentHistoryId,
  MessageId,
  SessionId,
  SessionInfo,
  WirePayload,
} from '@linkcode/schema';
import { useSeededConversation } from '@mobile/runtime/use-seeded-conversation';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { clientWrapper, connectClient } from './client-test-helpers';

const SESSION = 'session-1' as SessionId;
const HISTORY = 'history-1' as AgentHistoryId;

const SESSION_INFO: SessionInfo = {
  sessionId: SESSION,
  kind: 'claude-code',
  cwd: '/tmp',
  status: 'idle',
  createdAt: 0,
  updatedAt: 0,
  historyId: HISTORY,
};

/** Same session with no `historyId`, so the seed read short-circuits and only attach runs. */
const NO_HISTORY: SessionInfo = { ...SESSION_INFO, historyId: undefined };

function kinds(sent: readonly WirePayload[]): string[] {
  return sent.map((payload) => payload.kind);
}

async function mountSeeded(sessionId: SessionId | null, session: SessionInfo | null) {
  const { transport, client } = await connectClient();
  const view = renderHook(() => useSeededConversation(sessionId, session), {
    wrapper: clientWrapper(client),
  });
  return { transport, client, view };
}

it('announces the route session before the session list resolves', async () => {
  // The screen has the id from the route immediately but `SessionInfo` only a round-trip later.
  // Waiting for it would let the connection sit in `attached` scope with nothing announced, and
  // the events dropped in that window are not recoverable from the attach replay.
  const { transport, client } = await mountSeeded(SESSION, null);

  expect(transport.sent).toContainEqual({ kind: 'session.attach', sessionId: SESSION });
  expect(kinds(transport.sent)).not.toContain('history.read');
  client.dispose();
});

it('announces the session before reading its history', async () => {
  const { transport, client } = await mountSeeded(SESSION, SESSION_INFO);

  await waitFor(() => expect(kinds(transport.sent)).toContain('history.read'));
  // Attaching first is what asks the daemon to re-broadcast the buffered per-session state; the
  // read then walks the transcript. Reversed, the re-broadcast would land after the seed sampled
  // its cut.
  expect(kinds(transport.sent).indexOf('session.attach')).toBeLessThan(
    kinds(transport.sent).indexOf('history.read'),
  );
  expect(transport.sent).toContainEqual({ kind: 'session.attach', sessionId: SESSION });
  client.dispose();
});

it('withdraws the announcement when the screen goes away', async () => {
  const { transport, client, view } = await mountSeeded(SESSION, NO_HISTORY);

  expect(transport.sent).toContainEqual({ kind: 'session.attach', sessionId: SESSION });
  expect(kinds(transport.sent)).not.toContain('session.detach');

  view.unmount();

  expect(transport.sent).toContainEqual({ kind: 'session.detach', sessionId: SESSION });
  client.dispose();
});

it('announces nothing when there is no session to observe', async () => {
  const { transport, client, view } = await mountSeeded(null, null);

  view.unmount();

  expect(kinds(transport.sent)).not.toContain('session.attach');
  expect(kinds(transport.sent)).not.toContain('session.detach');
  client.dispose();
});

it('keeps an ask the re-broadcast delivered before the seed cut', async () => {
  const { transport, client, view } = await mountSeeded(SESSION, SESSION_INFO);
  await waitFor(() => expect(kinds(transport.sent)).toContain('history.read'));

  // What `session.attach` buys: an ask raised while the thread was closed. It arrives before the
  // seed samples `uptoSeq`, so it sits inside the cut — and survives only because it is ephemeral
  // and `history.read` can never cover it (CODE-35).
  transport.receive({
    kind: 'agent.event',
    sessionId: SESSION,
    event: {
      type: 'permission-request',
      requestId: 'p1',
      title: 'Run tests',
      subject: { type: 'tool-call', toolCallId: 't1' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
    },
  });

  const read = transport.sent.find((payload) => payload.kind === 'history.read');
  expect(read).toBeDefined();
  transport.receive({
    kind: 'history.read.result',
    replyTo: read!.clientReqId,
    result: {
      session: { historyId: HISTORY, kind: 'claude-code', title: 'Fixture' },
      events: [
        {
          historyId: HISTORY,
          event: {
            type: 'user-message',
            messageId: 'user-1' as MessageId,
            content: [{ type: 'text', text: 'hi' }],
          },
        },
      ],
    },
  });

  // Assert the seed landed first, or the ask would survive for the trivial reason that there is no
  // cut to sit inside.
  await waitFor(() =>
    expect(view.result.current.items).toContainEqual(
      expect.objectContaining({ kind: 'message', role: 'user' }),
    ),
  );
  expect(view.result.current.pendingPermissionIds).toEqual(['p1']);
  client.dispose();
});
