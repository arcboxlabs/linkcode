import type { WirePayload } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createSessionHarness, startedSessionId } from './fixtures/session-harness';

function changes(sent: WirePayload[]) {
  return sent.flatMap((payload) =>
    payload.kind === 'session.changed'
      ? [{ sessionId: payload.sessionId, reason: payload.reason }]
      : [],
  );
}

describe('engine session list changes', () => {
  it('announces a created session, then its settled identity, then its removal', async () => {
    const harness = createSessionHarness();
    await harness.engine.start();

    await harness.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedSessionId(harness.sent, 'r1');
    expect(changes(harness.sent)).toEqual([{ sessionId, reason: 'created' }]);

    // The title is derived from the first prompt, so it settles after the session is already listed.
    await harness.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('Fix the flaky test')] },
    });
    expect(changes(harness.sent)).toEqual([
      { sessionId, reason: 'created' },
      { sessionId, reason: 'updated' },
    ]);

    await harness.inject({ kind: 'session.delete', clientReqId: 'r3', sessionId });
    expect(changes(harness.sent).at(-1)).toEqual({ sessionId, reason: 'removed' });
  });

  it('stays quiet on activity that only moves the session up the recency order', async () => {
    const harness = createSessionHarness();
    await harness.engine.start();
    await harness.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const before = changes(harness.sent).length;

    harness.adapters[0].emit({ type: 'status', status: 'stopped' });

    expect(changes(harness.sent)).toHaveLength(before);
  });
});
