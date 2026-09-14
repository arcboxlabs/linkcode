import type { WirePayload } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createSessionHarness } from './fixtures/session-harness';

const requests: WirePayload[] = [
  {
    kind: 'turn.submit',
    clientReqId: 'r-submit',
    sessionId: 'session-1',
    operationId: 'op-1',
    input: { type: 'prompt', blocks: [{ type: 'text', text: 'hello' }] },
  },
  { kind: 'conversation.graph.get', clientReqId: 'r-graph', sessionId: 'session-1' },
  { kind: 'conversation.read', clientReqId: 'r-read', sessionId: 'session-1' },
] as WirePayload[];

describe('conversation request stubs', () => {
  it('refuses every conversation request loudly instead of dropping it', async () => {
    const h = createSessionHarness();
    await h.engine.start();

    await Promise.all(requests.map((request) => h.inject(request)));

    const replyIds = ['r-submit', 'r-graph', 'r-read'];
    for (let i = 0, len = replyIds.length; i < len; i++) {
      expect(h.sent).toContainEqual(
        expect.objectContaining({
          kind: 'request.failed',
          replyTo: replyIds[i],
          code: 'unsupported',
        }),
      );
    }
  });
});
