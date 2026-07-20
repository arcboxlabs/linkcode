import type { AgentEvent, MessageId, SessionId } from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { createConversationStore } from '../conversation-store';
import { createConnectedLocalClient } from './local-client';

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
  const { client, serverTransport } = await createConnectedLocalClient();
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
      events: [{ event: userText('from transcript'), ts: 1_700_000_000_000 }],
      uptoSeq: 2,
    });
    const seeded = store.getSnapshot();
    expect(seeded.items.map((i) => (i.kind === 'message' ? i.blocks : null))).toEqual([
      [{ type: 'text', text: 'from transcript' }],
    ]);
    // The provider timestamp stands in for the receive time live events get.
    expect(seeded.items[0].receivedAt).toBe(1_700_000_000_000);
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

  // CODE-35: a transcript snapshot can never contain ephemeral events (permission asks, status,
  // stop, errors) — a mid-turn seed read whose uptoSeq passes them must not erase them.
  it('keeps ephemeral live events that fall inside the snapshot cut', async () => {
    const { client, send, close } = await harness();
    const announce: AgentEvent = {
      type: 'tool-call',
      toolCall: {
        toolCallId: 't1',
        title: 'Bash',
        kind: 'execute',
        status: 'in_progress',
        content: [],
      },
    };
    const ask: AgentEvent = {
      type: 'permission-request',
      requestId: 'req-1',
      toolCall: { toolCallId: 't1', title: 'Bash' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    };
    send(userText('run echo'));
    send({ type: 'status', status: 'running' });
    send(announce);
    send(ask);
    await tick();

    // The snapshot (read mid-turn) already covers the prompt and the announce, never the ask.
    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('run echo') }, { event: announce }],
      uptoSeq: 4,
    });
    const conversation = store.getSnapshot();
    expect(conversation.pendingPermissionIds).toEqual(['req-1']);
    expect(conversation.items.some((i) => i.kind === 'approval')).toBe(true);
    expect(conversation.status).toBe('running');
    // No duplicates either: the seedable prompt/announce inside the cut fold only from the seed.
    expect(conversation.items.filter((i) => i.kind === 'message')).toHaveLength(1);
    expect(conversation.items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    close();
  });

  // CODE-272: mid-turn, the transcript lags the live stream — the in-flight reply has no
  // transcript row yet, so a reseed (focus/reconnect revalidation) must keep its live chunks
  // even though they fall inside the cut, or the rendered answer collapses to a suffix.
  it('keeps live chunks of a streaming message the snapshot has not flushed yet', async () => {
    const { client, send, close } = await harness();
    const chunk = (text: string): AgentEvent => ({
      type: 'agent-message-chunk',
      messageId: 'm1' as MessageId,
      content: { type: 'text', text },
    });
    send(userText('tell a story'));
    send({ type: 'status', status: 'running' });
    send(chunk('Once upon '));
    send(chunk('a time'));
    await tick();

    // Read resolved mid-turn: the snapshot has the prompt, not the streaming reply.
    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('tell a story') }],
      uptoSeq: 4,
    });
    send(chunk(', the end.'));
    await tick();

    const messages = store.getSnapshot().items.filter((i) => i.kind === 'message');
    expect(messages).toHaveLength(2);
    expect(messages[1].blocks).toEqual([{ type: 'text', text: 'Once upon a time, the end.' }]);
    close();
  });

  it('keeps an in-flight tool call the snapshot has not flushed yet', async () => {
    const { client, send, close } = await harness();
    const announce: AgentEvent = {
      type: 'tool-call',
      toolCall: {
        toolCallId: 't1',
        title: 'Bash',
        kind: 'execute',
        status: 'in_progress',
        content: [],
      },
    };
    send(userText('run echo'));
    send(announce);
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('run echo') }],
      uptoSeq: 2,
    });
    const items = store.getSnapshot().items;
    expect(items.filter((i) => i.kind === 'tool')).toHaveLength(1);
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
