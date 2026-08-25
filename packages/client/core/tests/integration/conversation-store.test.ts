import type { AgentEvent, MessageId, SessionId } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { Hub } from '@linkcode/transport/server';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../../src/client';
import { createConversationStore } from '../../src/conversation-store';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-store' as SessionId;

function userText(text: string, messageId = `user:${text}`, branchCursor?: string): AgentEvent {
  return {
    type: 'user-message',
    messageId: messageId as MessageId,
    content: [{ type: 'text', text }],
    ...(branchCursor !== undefined && { branchCursor }),
  };
}

function agentText(text: string, messageId: string): AgentEvent {
  return {
    type: 'agent-message',
    messageId: messageId as MessageId,
    content: [{ type: 'text', text }],
  };
}

function userTexts(store: ReturnType<typeof createConversationStore>): string[] {
  const { items } = store.getSnapshot();
  return items.flatMap((item) =>
    item.kind === 'message' && item.role === 'user' && item.blocks[0]?.type === 'text'
      ? [item.blocks[0].text]
      : [],
  );
}

function userCursors(store: ReturnType<typeof createConversationStore>): Array<string | undefined> {
  const { items } = store.getSnapshot();
  return items.flatMap((item) =>
    item.kind === 'message' && item.role === 'user' ? [item.branchCursor] : [],
  );
}

function tick(): Promise<void> {
  return wait(10);
}

async function harness() {
  const { client, serverTransport } = await createConnectedLocalClient();
  serverTransport.onMessage((message) => {
    if (message.payload.kind === 'session.start') {
      serverTransport.send(
        createWireMessage({
          kind: 'session.started',
          replyTo: message.payload.clientReqId,
          sessionId,
        }),
      );
    }
  });
  return {
    client,
    send(this: void, event: AgentEvent) {
      serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    },
    /** Round-trip a real session.start so the client records fresh-run creation provenance. */
    async createSession(this: void) {
      await client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    },
    close(this: void) {
      client.dispose();
      serverTransport.close();
    },
  };
}

async function attachedHarness() {
  const [clientTransport, hubTransport] = createLocalTransportPair();
  await hubTransport.connect();
  const hub = new Hub();
  hub.addConnection(hubTransport);
  const client = new LinkCodeClient(clientTransport);
  await client.connect();
  await client.setSubscriptionMode('attached');
  return {
    client,
    hub,
    close(this: void) {
      client.dispose();
      hub.removeConnection(hubTransport);
      hubTransport.close();
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

  it('covers matching host echoes by value without dropping an unflushed queued prompt', async () => {
    const { client, send, close } = await harness();
    send(userText('covered by transcript', 'host-1'));
    send(userText('queued and unflushed', 'host-2'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      // Provider history ids intentionally differ from the host-generated live echo ids.
      events: [{ event: userText('covered by transcript', 'provider-1'), ts: 1_700_000_000_000 }],
      uptoSeq: 2,
    });
    const seeded = store.getSnapshot();
    expect(seeded.items.map((i) => (i.kind === 'message' ? i.blocks : null))).toEqual([
      [{ type: 'text', text: 'covered by transcript' }],
      [{ type: 'text', text: 'queued and unflushed' }],
    ]);
    // The provider timestamp stands in for the receive time live events get.
    expect(seeded.items[0].receivedAt).toBe(1_700_000_000_000);
    // Identity is stable until the next event — the useSyncExternalStore contract.
    expect(store.getSnapshot()).toBe(seeded);

    send(userText('fresh'));
    await tick();
    const advanced = store.getSnapshot();
    expect(advanced).not.toBe(seeded);
    expect(advanced.items).toHaveLength(3);
    // The earlier snapshot is untouched (copy-on-write).
    expect(seeded.items).toHaveLength(2);
    close();
  });

  it('enriches a lossy seeded prompt with its live image instead of appending a duplicate', async () => {
    const { client, send, close } = await harness();
    const livePrompt: AgentEvent = {
      type: 'user-message',
      messageId: 'host-prompt' as MessageId,
      content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      ],
      branchCursor: 'live-cursor',
    };
    const reply: AgentEvent = {
      type: 'agent-message',
      messageId: 'reply' as MessageId,
      content: [{ type: 'text', text: 'It is a test image.' }],
    };
    send(livePrompt);
    send(reply);
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        // Some provider histories retain the prompt text but omit its image blocks.
        {
          event: {
            type: 'user-message',
            messageId: 'provider-prompt' as MessageId,
            content: [{ type: 'text', text: 'describe this image' }],
            branchCursor: 'provider-cursor',
          },
        },
        { event: reply },
      ],
      uptoSeq: 2,
    });

    const messages = store.getSnapshot().items.filter((item) => item.kind === 'message');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: 'provider-prompt',
      role: 'user',
      blocks: livePrompt.content,
      branchCursor: 'provider-cursor',
    });
    expect(messages[1]).toMatchObject({ id: 'reply', role: 'assistant' });
    close();
  });

  it('consumes only one matching seed row for repeated prompt content', async () => {
    const { client, send, close } = await harness();
    send(userText('repeat', 'host-1'));
    send(userText('repeat', 'host-2'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('repeat', 'provider-1') }],
      uptoSeq: 2,
    });

    const snapshot = store.getSnapshot();
    const messages = snapshot.items.filter(
      (item) => item.kind === 'message' && item.role === 'user',
    );
    expect(messages).toHaveLength(2);
    close();
  });

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

  it('deduplicates live chunks that the snapshot covers by message id', async () => {
    const { client, send, close } = await harness();
    const chunk = (text: string): AgentEvent => ({
      type: 'agent-message-chunk',
      messageId: 'history-row' as MessageId,
      content: { type: 'text', text },
    });
    send(userText('tell a story'));
    send({ type: 'status', status: 'running' });
    send(chunk('Once upon '));
    send(chunk('a time'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('tell a story') }, { event: chunk('Once upon a time') }],
      uptoSeq: 4,
    });

    const messages = store.getSnapshot().items.filter((item) => item.kind === 'message');
    expect(messages).toHaveLength(2);
    expect(messages[1].blocks).toEqual([{ type: 'text', text: 'Once upon a time' }]);
    close();
  });

  it('keeps an in-flight tool call the snapshot has not flushed yet', async () => {
    const { client, send, close } = await harness();
    const output = { type: 'content' as const, content: { type: 'text' as const, text: 'done' } };
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
    send({ type: 'tool-call-content-chunk', toolCallId: 't1', content: output });
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('run echo') }],
      uptoSeq: 3,
    });
    const items = store.getSnapshot().items;
    const tool = items.find((item) => item.kind === 'tool');
    expect(tool?.kind).toBe('tool');
    if (tool?.kind === 'tool') expect(tool.toolCall.content).toEqual([output]);
    close();
  });

  it('does not restore a rewritten suffix when the replacement transcript reseeds', async () => {
    const { client, send, close } = await harness();
    const keep = userText('keep');
    const source = userText('old prompt', 'source-message');
    const discarded = userText('discarded suffix');
    send(keep);
    send(source);
    send(discarded);
    await tick();

    const original = createConversationStore(client, sessionId, {
      events: [{ event: keep }, { event: source }, { event: discarded }],
      uptoSeq: 3,
    });
    expect(original.getSnapshot().items).toHaveLength(3);

    const replacement = userText('rewritten prompt', 'replacement-message');
    send({ type: 'conversation-rewind', messageId: 'source-message' as MessageId });
    send(replacement);
    await tick();
    expect(
      original
        .getSnapshot()
        .items.flatMap((item) =>
          item.kind === 'message' && item.blocks[0]?.type === 'text' ? [item.blocks[0].text] : [],
        ),
    ).toEqual(['keep', 'rewritten prompt']);

    const reseeded = createConversationStore(client, sessionId, {
      events: [{ event: keep }, { event: replacement }],
      uptoSeq: client.eventSeq(sessionId),
    });
    expect(
      reseeded
        .getSnapshot()
        .items.flatMap((item) =>
          item.kind === 'message' && item.blocks[0]?.type === 'text' ? [item.blocks[0].text] : [],
        ),
    ).toEqual(['keep', 'rewritten prompt']);
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

  it('keeps prompt order when a reseed covers a same-id double echo', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('old prompt', 'host-m1'));
    send(userText('old prompt', 'host-m1', 'live-cursor-old'));
    send(agentText('reply', 'provider-reply'));
    send(userText('new prompt', 'host-m2', 'live-cursor-new'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('old prompt', 'provider-u1') },
        { event: agentText('reply', 'provider-reply') },
        { event: userText('new prompt', 'provider-u2', 'provider-cursor-new') },
      ],
      uptoSeq: 4,
    });
    expect(userTexts(store)).toEqual(['old prompt', 'new prompt']);
    expect(userCursors(store)).toEqual(['live-cursor-old', 'provider-cursor-new']);
    close();
  });

  it('keeps a single covered prompt in place across a reseed', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('first prompt', 'host-m1'));
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    send(agentText('reply', 'provider-reply'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('first prompt', 'provider-u1') },
        { event: agentText('reply', 'provider-reply') },
      ],
      uptoSeq: 3,
    });
    expect(userTexts(store)).toEqual(['first prompt']);
    expect(userCursors(store)).toEqual(['live-cursor']);
    expect(store.getSnapshot().items).toHaveLength(2);
    close();
  });

  it('folds a covered prompt re-echo into the seed row even when it lands past the cut', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('first prompt', 'host-m1'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('first prompt', 'provider-u1') }],
      uptoSeq: 1,
    });
    expect(userTexts(store)).toEqual(['first prompt']);
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    await tick();
    expect(userTexts(store)).toEqual(['first prompt']);
    expect(userCursors(store)).toEqual(['live-cursor']);
    close();
  });

  it('keeps the seed row cursor when the consuming echo carries none', async () => {
    const { client, send, close } = await harness();
    send(userText('first prompt', 'host-m1'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('first prompt', 'provider-u1', 'provider-cursor') }],
      uptoSeq: 1,
    });
    expect(userCursors(store)).toEqual(['provider-cursor']);
    close();
  });

  it('never lets an echo cursor displace a provider cursor', async () => {
    const { client, send, close } = await harness();
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('first prompt', 'provider-u1', 'provider-cursor') }],
      uptoSeq: 1,
    });
    expect(userCursors(store)).toEqual(['provider-cursor']);
    close();
  });

  it('keeps provider cursors in place when a repeated prompt mis-binds', async () => {
    const { client, send, close } = await harness();
    send(userText('repeat', 'host-m2', 'live-cursor'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('repeat', 'provider-u1', 'provider-cursor-1') },
        { event: userText('repeat', 'provider-u2', 'provider-cursor-2') },
      ],
      uptoSeq: 1,
    });
    expect(userTexts(store)).toEqual(['repeat', 'repeat']);
    expect(userCursors(store)).toEqual(['provider-cursor-1', 'provider-cursor-2']);
    close();
  });

  it('never fills a cursor-less row through an ambiguous bind', async () => {
    const { client, send, close } = await harness();
    send(userText('repeat', 'host-m2', 'live-cursor'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('repeat', 'provider-u1') },
        { event: userText('repeat', 'provider-u2') },
      ],
      uptoSeq: 1,
    });
    expect(userTexts(store)).toEqual(['repeat', 'repeat']);
    expect(userCursors(store)).toEqual([undefined, undefined]);
    close();
  });

  it('does not aim a rewind through an ambiguous bind', async () => {
    const { client, send, close } = await harness();
    send(userText('repeat', 'host-m2', 'live-cursor'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('repeat', 'provider-u1') },
        { event: agentText('reply one', 'provider-r1') },
        { event: userText('repeat', 'provider-u2') },
        { event: agentText('reply two', 'provider-r2') },
      ],
      uptoSeq: 1,
    });
    expect(userTexts(store)).toEqual(['repeat', 'repeat']);

    send({ type: 'conversation-rewind', messageId: 'host-m2' as MessageId });
    send(userText('replacement prompt', 'host-m3'));
    await tick();
    expect(userTexts(store)).toEqual(['repeat', 'repeat', 'replacement prompt']);
    const { items } = store.getSnapshot();
    const agentTexts = items.flatMap((item) =>
      item.kind === 'message' && item.role === 'assistant' && item.blocks[0]?.type === 'text'
        ? [item.blocks[0].text]
        : [],
    );
    expect(agentTexts).toEqual(['reply one', 'reply two']);
    close();
  });

  it('translates a rewind citing the host id of the trusted first prompt', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('old prompt', 'host-m1'));
    send(agentText('reply', 'provider-reply'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('old prompt', 'provider-u1') },
        { event: agentText('reply', 'provider-reply') },
      ],
      uptoSeq: 2,
    });
    expect(userTexts(store)).toEqual(['old prompt']);

    // A live-only co-viewer rewrites the prompt it knows as host-m1; this store folded it as
    // provider-u1, so the trusted alias translates the rewind to cut the seeded entry.
    send({ type: 'conversation-rewind', messageId: 'host-m1' as MessageId });
    send(userText('rewritten prompt', 'host-m2'));
    await tick();
    expect(userTexts(store)).toEqual(['rewritten prompt']);
    close();
  });

  // Branch/rewrite production ordering: the replacement echoes bare before the new run's ref,
  // but the preceding rewind wiped the buffer — retained history forbids trusting the bind.
  it('does not trust a bare echo that follows a rewind', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('repeat', 'host-m0'));
    await tick();
    send({ type: 'conversation-rewind', messageId: 'host-m0' as MessageId });
    send(userText('repeat', 'host-m1'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('repeat', 'provider-u1') },
        { event: agentText('reply one', 'provider-r1') },
      ],
      uptoSeq: 3,
    });
    expect(userTexts(store)).toEqual(['repeat']);
    send(userText('repeat', 'host-m1', 'live-cursor'));
    await tick();
    expect(userCursors(store)).toEqual([undefined]);

    send({ type: 'conversation-rewind', messageId: 'host-m1' as MessageId });
    send(userText('replacement prompt', 'host-m2'));
    await tick();
    expect(userTexts(store)).toEqual(['repeat', 'replacement prompt']);
    close();
  });

  // A reconnected client sees seqs restart at 1 and record origin survives resumes — neither is
  // run provenance. Without same-client creation, a resume-window bare echo must not be trusted.
  it('does not trust a bare echo on a session this client did not create', async () => {
    const { client, send, close } = await harness();
    send(userText('first prompt', 'host-m1'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [{ event: userText('first prompt', 'provider-u1') }],
      uptoSeq: 1,
    });
    expect(userTexts(store)).toEqual(['first prompt']);
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    await tick();
    expect(userCursors(store)).toEqual([undefined]);
    send({ type: 'conversation-rewind', messageId: 'host-m1' as MessageId });
    send(userText('replacement prompt', 'host-m2'));
    await tick();
    expect(userTexts(store)).toEqual(['first prompt', 'replacement prompt']);
    close();
  });

  it('does not trust creation provenance before the first attached delivery', async () => {
    const { client, hub, close } = await attachedHarness();
    const broadcast = (event: AgentEvent): void => {
      hub.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    };
    hub.onMessage(({ payload }) => {
      if (payload.kind !== 'session.start' && payload.kind !== 'session.resume') return;
      if (payload.kind === 'session.resume') {
        broadcast({ type: 'status', status: 'starting' });
        broadcast({ type: 'status', status: 'idle' });
      }
      hub.send(
        createWireMessage({
          kind: 'session.started',
          replyTo: payload.clientReqId,
          sessionId,
        }),
      );
    });

    await client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    // Another client can create provider history before this attached-mode client observes the id.
    broadcast(userText('repeat', 'missed-old'));
    broadcast(agentText('valid old reply', 'provider-reply'));
    broadcast({ type: 'status', status: 'stopped' });
    await tick();
    expect(client.eventSeq(sessionId)).toBe(0);

    client.attachSession(sessionId);
    await tick();
    await client.resumeSession(sessionId);
    expect(client.eventsSnapshot(sessionId)[0]?.seq).toBe(1);
    // Claude can echo before its detached consume loop reports the resumed session-ref.
    broadcast(userText('repeat', 'host-new'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('repeat', 'provider-old') },
        { event: agentText('valid old reply', 'provider-reply') },
      ],
      uptoSeq: client.eventSeq(sessionId),
    });
    expect(userTexts(store)).toEqual(['repeat']);

    broadcast(userText('repeat', 'host-new', 'new-run-cursor'));
    await tick();
    expect(userCursors(store)).toEqual([undefined]);

    broadcast({ type: 'conversation-rewind', messageId: 'host-new' as MessageId });
    broadcast(userText('replacement', 'host-replacement'));
    await tick();
    expect(userTexts(store)).toEqual(['repeat', 'replacement']);
    close();
  });

  it('does not trust a bare echo bound past the first user row', async () => {
    const { client, send, createSession, close } = await harness();
    await createSession();
    send(userText('second prompt', 'host-m2'));
    await tick();

    const store = createConversationStore(client, sessionId, {
      events: [
        { event: userText('first prompt', 'provider-u1') },
        { event: userText('second prompt', 'provider-u2') },
      ],
      uptoSeq: 1,
    });
    send(userText('second prompt', 'host-m2', 'live-cursor'));
    await tick();
    expect(userCursors(store)).toEqual([undefined, undefined]);
    close();
  });

  it('folds a same-id re-echo in place when no seed covers it', async () => {
    const { client, send, close } = await harness();
    send(userText('first prompt', 'host-m1'));
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    send(agentText('reply', 'provider-reply'));
    await tick();

    const store = createConversationStore(client, sessionId);
    const items = store.getSnapshot().items;
    const user = items.find((i) => i.kind === 'message' && i.role === 'user');
    expect(user?.kind === 'message' ? user.branchCursor : undefined).toBe('live-cursor');
    expect(items.filter((i) => i.kind === 'message' && i.role === 'user')).toHaveLength(1);
    expect(items).toHaveLength(2);
    close();
  });

  it('folds a cursor-bearing re-echo of a prompt the snapshot never flushed', async () => {
    const { client, send, close } = await harness();
    send(userText('first prompt', 'host-m1'));
    await tick();

    const store = createConversationStore(client, sessionId, { events: [], uptoSeq: 1 });
    expect(userTexts(store)).toEqual(['first prompt']);
    send(userText('first prompt', 'host-m1', 'live-cursor'));
    await tick();
    expect(userTexts(store)).toEqual(['first prompt']);
    const user = store.getSnapshot().items.find((i) => i.kind === 'message' && i.role === 'user');
    expect(user?.kind === 'message' ? user.branchCursor : undefined).toBe('live-cursor');
    close();
  });
});
