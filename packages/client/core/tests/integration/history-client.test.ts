import type { AgentHistoryId, WirePayload } from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { createConnectedLocalClient } from '../support/local-client';

const historyId = 'hist-1' as AgentHistoryId;

describe('LinkCodeClient history API', () => {
  it('lists and reads history over wire', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind === 'history.list') {
        serverTransport.send(
          createWireMessage({
            kind: 'history.listed',
            replyTo: p.clientReqId,
            result: {
              sessions: [{ historyId, kind: 'codex', title: 'Fixture' }],
            },
          }),
        );
      } else if (p.kind === 'history.read') {
        serverTransport.send(
          createWireMessage({
            kind: 'history.read.result',
            replyTo: p.clientReqId,
            result: {
              session: { historyId, kind: 'codex', title: 'Fixture' },
              events: [
                {
                  historyId,
                  event: {
                    type: 'user-message',
                    content: [{ type: 'text', text: 'hello' }],
                  },
                },
              ],
            },
          }),
        );
      }
    });

    const listed = await client.listHistory('codex', { limit: 1 });
    expect(listed.sessions[0]?.historyId).toBe(historyId);

    const read = await client.readHistory('codex', { historyId, limit: 1 });
    expect(read.events[0]?.event.type).toBe('user-message');

    client.dispose();
    serverTransport.close();
  });

  it('rejects pending history requests on request.failed', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    serverTransport.onMessage((msg) => {
      const payload = failureFor(msg.payload);
      if (payload) serverTransport.send(createWireMessage(payload));
    });

    await expect(client.readHistory('codex', { historyId })).rejects.toThrow('no history');

    client.dispose();
    serverTransport.close();
  });
});

function failureFor(payload: WirePayload): WirePayload | undefined {
  if (payload.kind !== 'history.read') return undefined;
  return {
    kind: 'request.failed',
    replyTo: payload.clientReqId,
    message: 'no history',
  };
}
