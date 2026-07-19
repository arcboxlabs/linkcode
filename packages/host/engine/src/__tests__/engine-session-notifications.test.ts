import type { MessageId, WirePayload } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createSessionHarness, startedSessionId } from './fixtures/session-harness';

async function startedSession() {
  const harness = createSessionHarness();
  await harness.engine.start();
  await harness.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  const sessionId = startedSessionId(harness.sent, 'r1');
  await harness.inject({
    kind: 'agent.input',
    clientReqId: 'r2',
    sessionId,
    input: { type: 'prompt', content: [textBlock('Fix the flaky test')] },
  });
  return { ...harness, sessionId };
}

function notifications(sent: WirePayload[]) {
  return sent.flatMap((payload) =>
    payload.kind === 'session.notification' ? [payload.notification] : [],
  );
}

describe('engine session notifications', () => {
  it('broadcasts turn-completed with the record display fields on stop', async () => {
    const { sent, adapters, sessionId } = await startedSession();
    adapters[0].emit({ type: 'stop', stopReason: 'end_turn' });

    expect(notifications(sent)).toEqual([
      {
        sessionId,
        kind: 'claude-code',
        cwd: '/repo',
        title: 'Fix the flaky test',
        reason: { type: 'turn-completed', stopReason: 'end_turn' },
      },
    ]);
  });

  it('broadcasts awaiting-approval on permission-request, question-request, and error on error', async () => {
    const { sent, adapters, sessionId } = await startedSession();
    adapters[0].emit({
      type: 'permission-request',
      requestId: 'perm-1',
      toolCall: { toolCallId: 'tc-1', title: 'Bash: rm -rf node_modules' },
      options: [],
    });
    adapters[0].emit({
      type: 'question-request',
      requestId: 'ask-1',
      toolCall: { toolCallId: 'tc-2', title: 'AskUserQuestion' },
      questions: [],
    });
    adapters[0].emit({ type: 'error', message: 'agent crashed', recoverable: false });

    expect(notifications(sent).map((notification) => notification.reason)).toEqual([
      { type: 'awaiting-approval', toolTitle: 'Bash: rm -rf node_modules' },
      { type: 'awaiting-approval', toolTitle: 'AskUserQuestion' },
      { type: 'error', message: 'agent crashed' },
    ]);
    expect(notifications(sent).every((notification) => notification.sessionId === sessionId)).toBe(
      true,
    );
  });

  it('stays silent for non-notification events', async () => {
    const { sent, adapters } = await startedSession();
    adapters[0].emit({ type: 'status', status: 'running' });
    adapters[0].emit({ type: 'status', status: 'idle' });
    adapters[0].emit({
      type: 'agent-message-chunk',
      messageId: 'msg-1' as MessageId,
      content: textBlock('hi'),
    });

    expect(notifications(sent)).toEqual([]);
  });
});
