import { LinkCodeClient } from '@linkcode/client-core';
import type { ConversationReadItem, TurnId } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';

function userTexts(events: readonly ConversationReadItem[]): string[] {
  return events.flatMap((item) =>
    'event' in item && item.event.type === 'user-message'
      ? item.event.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
      : [],
  );
}

/** Shell-command turns settle at once in the mock, so a tree can be built without streaming. */
describe('dev mock turn lineages', () => {
  it('lands an explicit-parent submit as a sibling and reads either lineage', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });

    const a = await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const b = await client.submitTurn(sessionId, { type: 'shell-command', command: 'b' });
    let graph = await client.getConversationGraph(sessionId);
    expect(graph.activeLeafTurnId).toBe(b.turnId);

    // Editing B = a sibling under parent(B); the old lineage stays readable.
    const edited = await client.submitTurn(
      sessionId,
      { type: 'shell-command', command: 'b2' },
      { parentTurnId: a.turnId, expectedGraphRevision: graph.graphRevision },
    );
    graph = await client.getConversationGraph(sessionId);
    expect(graph.activeLeafTurnId).toBe(edited.turnId);
    expect(graph.graphRevision).toBe(3);
    const ordinals = new Map(graph.turns.map((turn) => [turn.turnId, turn.siblingOrdinal]));
    expect(ordinals.get(a.turnId)).toBe(1);
    expect(ordinals.get(b.turnId)).toBe(1);
    expect(ordinals.get(edited.turnId)).toBe(2);
    expect(graph.turns.find((turn) => turn.turnId === edited.turnId)?.parentTurnId).toBe(a.turnId);

    const active = await client.readConversation(sessionId);
    expect(active.leafTurnId).toBe(edited.turnId);
    expect(userTexts(active.events)).toEqual(['$ a', '$ b2']);
    const old = await client.readConversation(sessionId, { leafTurnId: b.turnId });
    expect(old.leafTurnId).toBe(b.turnId);
    expect(userTexts(old.events)).toEqual(['$ a', '$ b']);

    // A new root lineage: editing the first prompt.
    const root2 = await client.submitTurn(
      sessionId,
      { type: 'shell-command', command: 'a2' },
      { parentTurnId: null, expectedGraphRevision: graph.graphRevision },
    );
    graph = await client.getConversationGraph(sessionId);
    expect(graph.turns.find((turn) => turn.turnId === root2.turnId)).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 2,
    });
    expect(userTexts((await client.readConversation(sessionId)).events)).toEqual(['$ a2']);
    client.dispose();
  });

  it('refuses a stale revision, an unknown parent, and a submit while a turn runs', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const a = await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const graph = await client.getConversationGraph(sessionId);

    await expect(
      client.submitTurn(
        sessionId,
        { type: 'shell-command', command: 'stale' },
        { parentTurnId: a.turnId, expectedGraphRevision: graph.graphRevision - 1 },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      client.submitTurn(
        sessionId,
        { type: 'shell-command', command: 'orphan' },
        { parentTurnId: 'turn-nope' as TurnId, expectedGraphRevision: graph.graphRevision },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });

    // A prompt turn streams for a while: the session is busy until it settles.
    const running = await client.submitTurn(sessionId, {
      type: 'prompt',
      blocks: [{ type: 'text', text: 'slow reply' }],
    });
    const revision = nullthrow(client.latestGraphChange(sessionId)).graphRevision;
    await expect(
      client.submitTurn(
        sessionId,
        { type: 'shell-command', command: 'too soon' },
        { parentTurnId: running.turnId, expectedGraphRevision: revision },
      ),
    ).rejects.toMatchObject({ code: 'busy' });
    await client.send(sessionId, { type: 'cancel' });
    client.dispose();
  });

  it('refuses to read toward a turn the session does not have', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    await expect(
      client.readConversation(sessionId, { leafTurnId: 'turn-nope' as TurnId }),
    ).rejects.toMatchObject({ code: 'not_found' });
    client.dispose();
  });
});
