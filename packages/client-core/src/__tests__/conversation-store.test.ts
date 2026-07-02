import type { AgentEvent, SessionId } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../client';
import { createConversationStore } from '../conversation-store';

const sessionId = 'sess-store' as SessionId;

function userText(text: string): AgentEvent {
  return { type: 'user-message', content: [{ type: 'text', text }] };
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

async function harness() {
  const [clientTransport, serverTransport] = createLocalTransportPair();
  const client = new LinkCodeClient(clientTransport);
  await client.connect();
  await serverTransport.connect();
  return {
    client,
    send(this: void, event: AgentEvent) {
      serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    },
    close(this: void) {
      client.dispose();
      serverTransport.close();
    },
  };
}

describe('createConversationStore', () => {
  it('returns a stable empty conversation without a session', async () => {
    const { client, close } = await harness();
    const store = createConversationStore(client, null);
    expect(store.getSnapshot().items).toEqual([]);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    close();
  });

  it('folds the seed once and appends only live events past the uptoSeq cut', async () => {
    const { client, send, close } = await harness();
    send(userText('covered by transcript'));
    send(userText('also covered'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [userText('from transcript')],
      uptoSeq: 2,
    });
    const seeded = store.getSnapshot();
    expect(seeded.items.map((i) => (i.kind === 'message' ? i.blocks : null))).toEqual([
      [{ type: 'text', text: 'from transcript' }],
    ]);
    // Identity is stable until the next event — the useSyncExternalStore contract.
    expect(store.getSnapshot()).toBe(seeded);

    send(userText('fresh'));
    await tick();
    const advanced = store.getSnapshot();
    expect(advanced).not.toBe(seeded);
    expect(advanced.items).toHaveLength(2);
    // The earlier snapshot is untouched (copy-on-write).
    expect(seeded.items).toHaveLength(1);
    close();
  });

  it('projects live-only sessions without a seed', async () => {
    const { client, send, close } = await harness();
    const store = createConversationStore(client, sessionId);
    expect(store.getSnapshot().items).toEqual([]);
    send(userText('hello'));
    await tick();
    expect(store.getSnapshot().items).toHaveLength(1);
    close();
  });
});
