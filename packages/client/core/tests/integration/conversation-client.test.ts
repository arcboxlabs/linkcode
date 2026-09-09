import type { RunId, SessionId, TurnId } from '@linkcode/schema';
import { AttachmentIdSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import type { SequencedAgentEvent } from '../../src/client';
import { LinkCodeClient } from '../../src/client';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-conv' as SessionId;
const leafTurnId = 'turn-leaf' as TurnId;
const rOperationId = /^op-creq-/;

describe('LinkCodeClient conversation graph API', () => {
  it('advertises the graph path only for hosts at or above its wire version', async () => {
    const current = await createConnectedLocalClient();
    expect(current.client.supportsConversationGraph).toBe(true);
    current.client.dispose();
    current.serverTransport.close();

    const [clientTransport, serverTransport] = createLocalTransportPair();
    await serverTransport.connect();
    serverTransport.onMessage((message) => {
      if (message.payload.kind === 'ping') {
        serverTransport.send(
          createWireMessage({
            kind: 'pong',
            version: WIRE_PROTOCOL_VERSION - 1,
            minCompatible: WIRE_PROTOCOL_VERSION - 4,
          }),
        );
      }
    });
    const older = new LinkCodeClient(clientTransport);
    await older.connect();
    expect(older.supportsConversationGraph).toBe(false);
    older.dispose();
    serverTransport.close();
  });

  it('keeps the daemon position and attribution on buffered events', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const seen: SequencedAgentEvent[] = [];
    client.subscribe(sessionId, (entry) => seen.push(entry));

    serverTransport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        runId: 'run-1' as RunId,
        turnId: 'turn-1' as TurnId,
        epoch: 4,
        seq: 7,
        event: { type: 'status', status: 'running' },
      }),
    );
    serverTransport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'status', status: 'idle' },
      }),
    );
    await wait(10);

    expect(client.eventsSnapshot(sessionId)).toMatchObject([
      { seq: 1, position: { epoch: 4, seq: 7 }, runId: 'run-1', turnId: 'turn-1' },
      { seq: 2 },
    ]);
    // An unstamped frame (≤v79 host) carries no position at all.
    expect(client.eventsSnapshot(sessionId)[1]).not.toHaveProperty('position');
    expect(seen.map((entry) => entry.position)).toEqual([{ epoch: 4, seq: 7 }, undefined]);

    client.dispose();
    serverTransport.close();
  });

  it('registers the newest graph change per session and ignores stale announcements', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const seen: number[] = [];
    client.subscribeGraphChanges(sessionId, (change) => seen.push(change.graphRevision));

    serverTransport.send(
      createWireMessage({
        kind: 'conversation.graph.changed',
        sessionId,
        graphRevision: 2,
        activeLeafTurnId: leafTurnId,
      }),
    );
    serverTransport.send(
      createWireMessage({ kind: 'conversation.graph.changed', sessionId, graphRevision: 1 }),
    );
    await wait(10);

    expect(client.latestGraphChange(sessionId)).toEqual({
      graphRevision: 2,
      activeLeafTurnId: leafTurnId,
    });
    expect(seen).toEqual([2]);

    client.dispose();
    serverTransport.close();
  });

  it('resolves the turn tree', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind !== 'conversation.graph.get') return;
      serverTransport.send(
        createWireMessage({
          kind: 'conversation.graph.result',
          replyTo: p.clientReqId,
          sessionId: p.sessionId,
          graphRevision: 1,
          activeLeafTurnId: leafTurnId,
          turns: [
            {
              turnId: leafTurnId,
              sessionId,
              parentTurnId: null,
              siblingOrdinal: 1,
              input: { type: 'shell-command', command: 'ls' },
              runId: 'run-1' as RunId,
              state: 'completed',
              createdAt: 1,
              inputSummary: '$ ls',
            },
          ],
        }),
      );
    });

    const graph = await client.getConversationGraph(sessionId);
    expect(graph.activeLeafTurnId).toBe(leafTurnId);
    expect(graph.turns).toHaveLength(1);

    client.dispose();
    serverTransport.close();
  });

  it('resolves a plain-send turn.submit without parent or revision', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const submitted: unknown[] = [];
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind !== 'turn.submit') return;
      submitted.push(p);
      serverTransport.send(
        createWireMessage({
          kind: 'turn.submitted',
          replyTo: p.clientReqId,
          turnId: leafTurnId,
        }),
      );
    });

    const attachmentId = AttachmentIdSchema.parse('att-1');
    await expect(
      client.submitTurn(sessionId, {
        type: 'prompt',
        blocks: [
          { type: 'text', text: 'look' },
          { type: 'attachment_ref', attachmentId },
        ],
      }),
    ).resolves.toEqual({ turnId: leafTurnId });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(
      expect.objectContaining({
        kind: 'turn.submit',
        sessionId,
        input: {
          type: 'prompt',
          blocks: [
            { type: 'text', text: 'look' },
            { type: 'attachment_ref', attachmentId },
          ],
        },
      }),
    );
    expect(submitted[0]).not.toHaveProperty('parentTurnId');
    expect(submitted[0]).not.toHaveProperty('expectedGraphRevision');
    expect(submitted[0]).toEqual(
      expect.objectContaining({ operationId: expect.stringMatching(rOperationId) }),
    );

    client.dispose();
    serverTransport.close();
  });
});
