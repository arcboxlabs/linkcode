import type {
  AgentEvent,
  AgentStartCatalog,
  McpPluginCatalog,
  MessageId,
  PermissionOutcome,
  PluginConfigPublic,
  SessionId,
  SessionNotification,
  WirePayload,
} from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { SequencedAgentEvent } from '../../src/client';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-control' as SessionId;

describe('LinkCodeClient control API', () => {
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

  it('reads the plugin catalog and masked plugin config through correlated requests', async () => {
    let requestNumber = 0;
    const { client, serverTransport } = await createConnectedLocalClient({
      randomUUID: () => `plugin-${++requestNumber}`,
    });
    const catalog: McpPluginCatalog = [
      {
        id: 'github-read',
        labelKey: 'units.githubRead.label',
        descriptionKey: 'units.githubRead.description',
        servers: [{ type: 'managed', name: 'linkcode-github', service: 'github' }],
      },
    ];
    const plugins: PluginConfigPublic = {
      units: [{ unitId: 'github-read', enabled: true }],
      serviceBindings: { github: { type: 'managed' } },
      connectors: [],
      customServers: [],
    };

    serverTransport.onMessage((msg) => {
      const payload = msg.payload;
      if (payload.kind === 'plugin.catalog.get') {
        serverTransport.send(
          createWireMessage({
            kind: 'plugin.catalog.result',
            replyTo: payload.clientReqId,
            catalog,
          }),
        );
      }
      if (payload.kind === 'config.get') {
        serverTransport.send(
          createWireMessage({
            kind: 'config.get.result',
            replyTo: payload.clientReqId,
            providers: {},
            accounts: [],
            plugins,
          }),
        );
      }
    });

    await expect(client.getPluginCatalog()).resolves.toEqual(catalog);
    await expect(client.getPluginConfig()).resolves.toEqual(plugins);

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
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(seen).toEqual([notification]);

    unsubscribe();
    serverTransport.send(createWireMessage({ kind: 'session.notification', notification }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
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
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

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
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    const snapshot = client.eventsSnapshot(sessionId);
    expect(snapshot).toEqual([{ event, seq: 1, receivedAt: expect.any(Number) as number }]);
    // Identity is stable until the next event — the useSyncExternalStore contract.
    expect(client.eventsSnapshot(sessionId)).toBe(snapshot);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
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
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    await client.stopSession(sessionId);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
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
