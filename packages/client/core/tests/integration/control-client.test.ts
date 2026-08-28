import type {
  AgentEvent,
  AgentStartCatalog,
  MessageId,
  PermissionOutcome,
  SessionId,
  SessionNotification,
  WirePayload,
} from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import type { SequencedAgentEvent } from '../../src/client';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-control' as SessionId;

describe('LinkCodeClient control API', () => {
  it('routes git branch switch checks and mutation acknowledgements', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind === 'git.branch.switch.check') {
        serverTransport.send(
          createWireMessage({
            kind: 'git.branch.switch.check.result',
            replyTo: p.clientReqId,
            check: { status: 'ready' },
          }),
        );
      } else if (p.kind === 'git.branch.create' || p.kind === 'git.commit') {
        serverTransport.send(
          createWireMessage({ kind: 'request.succeeded', replyTo: p.clientReqId }),
        );
      }
    });

    await expect(client.checkGitBranchSwitch('/repo', 'main')).resolves.toEqual({
      status: 'ready',
    });
    await expect(client.createGitBranch('/repo', 'feature')).resolves.toEqual({ ok: true });
    await expect(client.commitGitChanges('/repo', 'save')).resolves.toEqual({ ok: true });

    client.dispose();
    serverTransport.close();
  });

  it('preserves MCP warnings on detailed session-start results', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      if (msg.payload.kind !== 'session.start') return;
      serverTransport.send(
        createWireMessage({
          kind: 'session.started',
          replyTo: msg.payload.clientReqId,
          sessionId,
          mcpWarnings: [{ serverName: 'github', reason: 'provider-unsupported' }],
        }),
      );
    });

    await expect(client.startSessionWithWarnings({ kind: 'codex', cwd: '/repo' })).resolves.toEqual(
      {
        sessionId,
        mcpWarnings: [{ serverName: 'github', reason: 'provider-unsupported' }],
      },
    );

    client.dispose();
    serverTransport.close();
  });

  it('gets the matching pre-session agent catalog with agent kind and cwd', async () => {
    const { client, serverTransport } = await createConnectedLocalClient({
      randomUUID: () => 'catalog-request',
    });
    const catalog: AgentStartCatalog = {
      models: [{ id: 'pi/sonnet', label: 'Sonnet', effortLevels: ['low', 'high'] }],
      policies: [{ policyId: 'default', name: 'Default' }],
      defaultPolicyId: 'default',
    };

    serverTransport.onMessage((msg) => {
      if (msg.payload.kind !== 'agent.catalog') return;
      expect(msg.payload).toEqual({
        kind: 'agent.catalog',
        clientReqId: 'creq-catalog-request',
        agentKind: 'pi',
        cwd: '/repo',
      });
      serverTransport.send(
        createWireMessage({
          kind: 'agent.cataloged',
          replyTo: 'creq-unrelated',
          catalog: { models: [], policies: [] },
        }),
      );
      serverTransport.send(
        createWireMessage({
          kind: 'agent.cataloged',
          replyTo: msg.payload.clientReqId,
          catalog,
        }),
      );
    });

    await expect(client.getAgentCatalog('pi', '/repo')).resolves.toEqual(catalog);

    client.dispose();
    serverTransport.close();
  });

  it('rejects and removes a pre-session catalog request on request.failed', async () => {
    let requestNumber = 0;
    const { client, serverTransport } = await createConnectedLocalClient({
      randomUUID: () => `catalog-${++requestNumber}`,
    });
    serverTransport.onMessage((msg) => {
      if (msg.payload.kind !== 'agent.catalog') return;
      if (msg.payload.clientReqId === 'creq-catalog-1') {
        serverTransport.send(
          createWireMessage({
            kind: 'request.failed',
            replyTo: msg.payload.clientReqId,
            message: 'catalog unavailable',
          }),
        );
        return;
      }
      serverTransport.send(
        createWireMessage({
          kind: 'agent.cataloged',
          replyTo: msg.payload.clientReqId,
          catalog: { models: [], policies: [] },
        }),
      );
    });

    await expect(client.getAgentCatalog('pi')).rejects.toThrow('catalog unavailable');
    await expect(client.getAgentCatalog('pi')).resolves.toEqual({ models: [], policies: [] });

    client.dispose();
    serverTransport.close();
  });

  it('waits for control acknowledgements', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    serverTransport.onMessage((msg) => {
      const payload = successFor(msg.payload);
      if (payload) serverTransport.send(createWireMessage(payload));
    });

    await expect(client.promptText(sessionId, 'hello')).resolves.toEqual({ ok: true });
    await expect(client.cancel(sessionId)).resolves.toEqual({ ok: true });
    await expect(client.stopSession(sessionId)).resolves.toEqual({ ok: true });
    await expect(client.deleteSession(sessionId)).resolves.toEqual({ ok: true });

    client.dispose();
    serverTransport.close();
  });

  it('rejects control calls on request.failed', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const outcome: PermissionOutcome = { outcome: 'selected', optionId: 'reject' };

    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind === 'agent.input') {
        serverTransport.send(
          createWireMessage({
            kind: 'request.failed',
            replyTo: p.clientReqId,
            message: 'permission request is no longer pending',
          }),
        );
      }
    });

    await expect(client.respondPermission(sessionId, 'perm-1', outcome)).rejects.toThrow(
      'permission request is no longer pending',
    );

    client.dispose();
    serverTransport.close();
  });

  it('preserves conversation reporting metadata on request failures', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    serverTransport.onMessage((msg) => {
      if (msg.payload.kind !== 'agent.input') return;
      serverTransport.send(
        createWireMessage({
          kind: 'request.failed',
          replyTo: msg.payload.clientReqId,
          code: 'conflict',
          message: 'Session is busy',
          reportedInConversation: true,
        }),
      );
    });

    await expect(client.promptText(sessionId, 'hello')).rejects.toMatchObject({
      code: 'conflict',
      message: 'Session is busy',
      reportedInConversation: true,
    });

    client.dispose();
    serverTransport.close();
  });
});

describe('LinkCodeClient event delivery scope', () => {
  it('requires uninterrupted all-event delivery for fresh-session provenance', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const nextSessionId = 'sess-control-next' as SessionId;
    const lastSessionId = 'sess-control-last' as SessionId;
    const stableSessionId = 'sess-control-stable' as SessionId;
    const sessionIds = [sessionId, nextSessionId, lastSessionId, stableSessionId];
    const delayedReplies: Array<() => void> = [];
    let sessionIndex = 0;

    serverTransport.onMessage((msg) => {
      const payload = msg.payload;
      if (payload.kind === 'session.start') {
        const startedSessionId = sessionIds[sessionIndex] ?? lastSessionId;
        sessionIndex += 1;
        const reply = (): void => {
          serverTransport.send(
            createWireMessage({
              kind: 'session.started',
              replyTo: payload.clientReqId,
              sessionId: startedSessionId,
            }),
          );
        };
        if (sessionIndex === 1) reply();
        else delayedReplies.push(reply);
      } else if (payload.kind === 'subscription.set') {
        serverTransport.send(
          createWireMessage({ kind: 'request.succeeded', replyTo: payload.clientReqId }),
        );
      }
    });

    const first = await client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    expect(client.hasFreshSessionProvenance(first)).toBe(true);
    await client.setSubscriptionMode('attached');
    expect(client.hasFreshSessionProvenance(first)).toBe(false);
    const attachedStart = client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    await wait(10);
    await client.setSubscriptionMode('all');
    nullthrow(delayedReplies[0])();
    const second = await attachedStart;
    expect(client.hasFreshSessionProvenance(second)).toBe(false);

    const interruptedStart = client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    await wait(10);
    await client.setSubscriptionMode('attached');
    await client.setSubscriptionMode('all');
    nullthrow(delayedReplies[1])();
    const third = await interruptedStart;
    expect(client.hasFreshSessionProvenance(third)).toBe(false);

    const stableStart = client.startSession({ kind: 'claude-code', cwd: '/workspace' });
    await wait(10);
    nullthrow(delayedReplies[2])();
    const fourth = await stableStart;
    expect(client.hasFreshSessionProvenance(fourth)).toBe(true);

    client.dispose();
    serverTransport.close();
  });

  it('negotiates the subscription mode and announces which sessions it observes', async () => {
    const { client, serverTransport } = await createConnectedLocalClient({
      randomUUID: () => 'scope',
    });
    const seen: WirePayload[] = [];

    serverTransport.onMessage((msg) => {
      seen.push(msg.payload);
      if (msg.payload.kind !== 'subscription.set') return;
      serverTransport.send(
        createWireMessage({ kind: 'request.succeeded', replyTo: msg.payload.clientReqId }),
      );
    });

    await expect(client.setSubscriptionMode('attached')).resolves.toEqual({ ok: true });
    expect(seen).toContainEqual({
      kind: 'subscription.set',
      clientReqId: 'creq-scope',
      mode: 'attached',
    });

    // Fire-and-forget, so the assertion is on the frame rather than on a reply.
    client.attachSession(sessionId);
    client.detachSession(sessionId);
    await wait(10);
    expect(seen).toContainEqual({ kind: 'session.attach', sessionId });
    expect(seen).toContainEqual({ kind: 'session.detach', sessionId });

    client.dispose();
    serverTransport.close();
  });

  it('drops announcements once the connection is gone', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const seen: WirePayload[] = [];
    serverTransport.onMessage((msg) => seen.push(msg.payload));

    // A surface unmounts only after `ConnectionController` has disposed the generation, so its
    // teardown detach arrives on a dead client. The Hub has already discarded the connection's
    // whole subscription, and every socket transport throws on send with no socket open.
    client.dispose();

    expect(() => client.detachSession(sessionId)).not.toThrow();
    expect(() => client.attachSession(sessionId)).not.toThrow();
    await wait(10);
    expect(seen).toEqual([]);

    serverTransport.close();
  });
});

describe('LinkCodeClient session notifications', () => {
  it('fans session.notification broadcasts out to subscribers until unsubscribed', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    const seen: SessionNotification[] = [];
    const unsubscribe = client.subscribeSessionNotification((n) => seen.push(n));
    const notification: SessionNotification = {
      sessionId,
      kind: 'claude-code',
      cwd: '/repo',
      title: 'Fix the flaky test',
      reason: { type: 'turn-completed', stopReason: 'end_turn' },
    };
    serverTransport.send(createWireMessage({ kind: 'session.notification', notification }));
    await wait(10);
    expect(seen).toEqual([notification]);

    unsubscribe();
    serverTransport.send(createWireMessage({ kind: 'session.notification', notification }));
    await wait(10);
    expect(seen).toHaveLength(1);

    client.dispose();
    serverTransport.close();
  });
});

describe('LinkCodeClient event buffer', () => {
  it('sequences received events and replays them to a late subscriber with original seqs', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    const first: AgentEvent = {
      type: 'user-message',
      messageId: 'user-1' as MessageId,
      content: [{ type: 'text', text: 'hi' }],
    };
    const second: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event: first }));
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event: second }));
    await wait(10);

    expect(client.eventSeq(sessionId)).toBe(2);

    // A late subscriber replays the buffer with the original seqs, not renumbered ones.
    const seen: Array<Pick<SequencedAgentEvent, 'event' | 'seq'>> = [];
    client.subscribe(sessionId, (event, seq) => seen.push({ event, seq }));
    expect(seen).toEqual([
      { event: first, seq: 1 },
      { event: second, seq: 2 },
    ]);

    client.dispose();
    serverTransport.close();
  });

  it('serves a stable events snapshot between changes and a fresh one per event', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    expect(client.eventsSnapshot(sessionId)).toBe(client.eventsSnapshot(sessionId));
    expect(client.eventsSnapshot(sessionId)).toEqual([]);

    const event: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await wait(10);

    const snapshot = client.eventsSnapshot(sessionId);
    expect(snapshot).toEqual([{ event, seq: 1, receivedAt: expect.any(Number) as number }]);
    // Identity is stable until the next event — the useSyncExternalStore contract.
    expect(client.eventsSnapshot(sessionId)).toBe(snapshot);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await wait(10);
    expect(client.eventsSnapshot(sessionId)).not.toBe(snapshot);
    expect(client.eventsSnapshot(sessionId)).toHaveLength(2);

    client.dispose();
    serverTransport.close();
  });

  it('keeps the seq counter monotone across a stop that clears the buffer', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();

    serverTransport.onMessage((msg) => {
      const payload = successFor(msg.payload);
      if (payload) serverTransport.send(createWireMessage(payload));
    });

    const event: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await wait(10);
    await client.stopSession(sessionId);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await wait(10);
    // Were the counter reset with the buffer, a pre-stop uptoSeq would swallow this event.
    expect(client.eventSeq(sessionId)).toBe(2);
    const seen: Array<Pick<SequencedAgentEvent, 'event' | 'seq'>> = [];
    client.subscribe(sessionId, (e, seq) => seen.push({ event: e, seq }));
    expect(seen).toEqual([{ event, seq: 2 }]);

    client.dispose();
    serverTransport.close();
  });
});

function successFor(payload: WirePayload): WirePayload | undefined {
  if (
    payload.kind !== 'agent.input' &&
    payload.kind !== 'session.stop' &&
    payload.kind !== 'session.delete'
  ) {
    return undefined;
  }
  return {
    kind: 'request.succeeded',
    replyTo: payload.clientReqId,
  };
}
