import type {
  ConversationReadItem,
  MessageId,
  SessionId,
  TurnId,
  WirePayload,
} from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { ConversationReadPage } from '../../src/client';
import { readConversationProjection, readConversationSeed } from '../../src/conversation-read';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-read' as SessionId;
const leafTurnId = 'turn-leaf' as TurnId;

type ReadRequest = Extract<WirePayload, { kind: 'conversation.read' }>;

function userRow(turnId: string, text: string): ConversationReadItem {
  return {
    turnId: turnId as TurnId,
    event: {
      type: 'user-message',
      messageId: `msg-${turnId}` as MessageId,
      content: [{ type: 'text', text }],
    },
  };
}

function page(
  items: ConversationReadItem[],
  extra: Partial<Pick<ConversationReadPage, 'graphRevision' | 'leafTurnId' | 'cursor'>> & {
    watermark?: ConversationReadPage['watermark'];
  } = {},
): ConversationReadPage {
  return {
    sessionId,
    graphRevision: extra.graphRevision ?? 3,
    ...('leafTurnId' in extra ? { leafTurnId: extra.leafTurnId } : { leafTurnId }),
    ...(extra.watermark !== undefined && { watermark: extra.watermark }),
    events: items,
    ...(extra.cursor !== undefined && { cursor: extra.cursor }),
  };
}

/** A daemon double that answers every `conversation.read` from `script(request, call)`. */
async function readingHarness(
  script: (request: ReadRequest, call: number) => ConversationReadPage | { conflict: true },
) {
  const { client, serverTransport } = await createConnectedLocalClient();
  const requests: ReadRequest[] = [];
  serverTransport.onMessage((msg) => {
    const p = msg.payload;
    if (p.kind !== 'conversation.read') return;
    requests.push(p);
    const answer = script(p, requests.length);
    serverTransport.send(
      createWireMessage(
        'conflict' in answer
          ? {
              kind: 'request.failed',
              replyTo: p.clientReqId,
              code: 'conflict',
              message: 'The conversation changed while paging; restart the read',
            }
          : { kind: 'conversation.read.result', replyTo: p.clientReqId, ...answer },
      ),
    );
  });
  return {
    client,
    requests,
    close(this: void) {
      client.dispose();
      serverTransport.close();
    },
  };
}

describe('readConversationProjection', () => {
  it('walks every page into one seed carrying only the final page’s watermark', async () => {
    const { client, requests, close } = await readingHarness((request) =>
      request.cursor === undefined
        ? page([userRow('turn-1', 'one')], { cursor: 'c1' })
        : page([userRow('turn-leaf', 'two')], { watermark: { epoch: 2, seq: 9 } }),
    );

    const seed = await readConversationProjection(client, sessionId);

    expect(seed).toEqual({
      items: [userRow('turn-1', 'one'), userRow('turn-leaf', 'two')],
      graphRevision: 3,
      leafTurnId,
      watermark: { epoch: 2, seq: 9 },
    });
    expect(requests.map((request) => request.cursor)).toEqual([undefined, 'c1']);
    close();
  });

  it('restarts the walk when the graph revision drifts between pages', async () => {
    const { client, requests, close } = await readingHarness((request, call) => {
      if (request.cursor === undefined) {
        return page([userRow('turn-1', 'one')], {
          graphRevision: call === 1 ? 3 : 4,
          cursor: 'c1',
        });
      }
      return page([userRow('turn-leaf', 'two')], {
        graphRevision: 4,
        watermark: { epoch: 2, seq: 9 },
      });
    });

    const seed = await readConversationProjection(client, sessionId);

    // Page two moved to revision 4 under the first walk; the second walk is consistent at 4.
    expect(seed?.graphRevision).toBe(4);
    expect(seed?.items).toHaveLength(2);
    expect(requests).toHaveLength(4);
    close();
  });

  it('restarts on the daemon’s typed conflict', async () => {
    const { client, requests, close } = await readingHarness((request, call) => {
      if (request.cursor === undefined) return page([userRow('turn-1', 'one')], { cursor: 'c1' });
      if (call === 2) return { conflict: true };
      return page([userRow('turn-leaf', 'two')], { watermark: { epoch: 2, seq: 9 } });
    });

    const seed = await readConversationProjection(client, sessionId);

    expect(seed?.items).toHaveLength(2);
    expect(requests).toHaveLength(4);
    close();
  });

  it('gives up after the graph keeps moving', async () => {
    const { client, close } = await readingHarness((request, call) =>
      request.cursor === undefined
        ? page([userRow('turn-1', 'one')], { graphRevision: call, cursor: 'c1' })
        : page([userRow('turn-leaf', 'two')], { graphRevision: call + 100 }),
    );

    await expect(readConversationProjection(client, sessionId)).rejects.toThrow(
      'changed while paging',
    );
    close();
  });

  it('resolves undefined for a session without a turn graph', async () => {
    const { client, close } = await readingHarness(() =>
      page([], { leafTurnId: undefined, graphRevision: 0, watermark: { epoch: 5, seq: 0 } }),
    );

    await expect(readConversationProjection(client, sessionId)).resolves.toBeUndefined();
    close();
  });

  it('reads toward the leaf a seed source names instead of the active one', async () => {
    const parked = 'turn-old' as TurnId;
    const { client, requests, close } = await readingHarness(() =>
      page([userRow('turn-old', 'old version')], {
        leafTurnId: parked,
        watermark: { epoch: 1, seq: 4 },
      }),
    );
    const seed = await readConversationSeed(client, {
      sessionId,
      agentKind: 'codex',
      cwd: '/repo',
      leafTurnId: parked,
    });
    expect(requests.map((request) => request.leafTurnId)).toEqual([parked]);
    expect(seed !== undefined && 'items' in seed ? seed.leafTurnId : undefined).toBe(parked);
    close();
  });
});
