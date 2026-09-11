import type { ConversationResyncReason } from '@linkcode/client-core';
import {
  createConversationStore,
  LinkCodeClient,
  readConversationSeed,
} from '@linkcode/client-core';
import { userRowMessageId } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { nullthrow } from 'foxts/guard';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';

/** The client-side seed path end to end against the mock host: what dev:mock exercises. */
describe('dev mock projection seeding', () => {
  it('seeds through the turn graph once a session has turns and re-reads on a relaunch', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    expect(client.supportsConversationGraph).toBe(true);

    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    client.attachSession(sessionId);
    const source = { sessionId, agentKind: 'codex' as const, cwd: '/mock/repo' };
    // No turn rows and no transcript: nothing to seed, the store runs live-only.
    await expect(readConversationSeed(client, source)).resolves.toBeUndefined();

    const liveResyncs: ConversationResyncReason[] = [];
    createConversationStore(client, sessionId, undefined, {
      onResync: (reason) => liveResyncs.push(reason),
    }).subscribe(noop);

    await client.promptText(sessionId, 'Hello mocked daemon');
    await wait(10);
    expect(liveResyncs).toEqual(['graph']);

    const change = nullthrow(client.latestGraphChange(sessionId));
    const leaf = nullthrow(change.activeLeafTurnId);

    const seed = await readConversationSeed(client, source);
    if (seed === undefined || !('items' in seed)) throw new Error('expected a projection seed');
    expect(seed.leafTurnId).toBe(leaf);
    expect(seed.graphRevision).toBe(1);
    // The watermark is the last stamped frame the client already holds.
    expect(seed.watermark).toEqual(client.eventsSnapshot(sessionId).at(-1)?.position);

    const resyncs: ConversationResyncReason[] = [];
    const store = createConversationStore(client, sessionId, seed, {
      onResync: (reason) => resyncs.push(reason),
    });
    store.subscribe(noop);
    const items = store.getSnapshot().items;
    // One user row under the turn identity — the live echo folded once, never twice.
    expect(items.filter((item) => item.kind === 'message' && item.role === 'user')).toEqual([
      expect.objectContaining({ id: userRowMessageId(leaf) }),
    ]);
    expect(items.some((item) => item.kind === 'message' && item.role === 'assistant')).toBe(true);
    expect(items.some((item) => item.kind === 'history-unavailable')).toBe(false);

    // A turn without output renders the prompt-only placeholder under its row.
    await client.runShellCommand(sessionId, 'ls');
    await wait(10);
    expect(resyncs).toEqual([]);
    const reseed = await readConversationSeed(client, source);
    if (reseed === undefined || !('items' in reseed)) throw new Error('expected a projection seed');
    const shellLeaf = nullthrow(client.latestGraphChange(sessionId)?.activeLeafTurnId);
    const reseeded = createConversationStore(client, sessionId, reseed).getSnapshot().items;
    const rowIndex = reseeded.findIndex((item) => item.id === userRowMessageId(shellLeaf));
    expect(rowIndex).toBeGreaterThan(0);
    expect(reseeded[rowIndex + 1]).toMatchObject({
      kind: 'history-unavailable',
      turnId: reseeded[rowIndex].turnId,
    });

    // Stop + resume relaunches under the next epoch: the earlier store asks for one re-read.
    await client.stopSession(sessionId);
    await client.resumeSession(sessionId);
    await wait(50);
    store.getSnapshot();
    await wait(10);
    expect(resyncs).toEqual(['epoch']);

    client.dispose();
  }, 15000);
});
