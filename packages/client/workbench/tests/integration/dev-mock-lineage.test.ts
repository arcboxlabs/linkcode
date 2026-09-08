import { LinkCodeClient } from '@linkcode/client-core';
import type { ConversationReadItem, TurnId } from '@linkcode/schema';
import { userRowMessageId } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it, vi } from 'vitest';
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
    // The daemon judges the parent before the revision.
    await expect(
      client.submitTurn(
        sessionId,
        { type: 'shell-command', command: 'orphan' },
        { parentTurnId: 'turn-nope' as TurnId, expectedGraphRevision: graph.graphRevision - 1 },
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

  it('re-announces a turn that failed after it began at the same revision, keeping its ordinal and the leaf', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    client.attachSession(sessionId);
    await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const failing = await client.submitTurn(sessionId, {
      type: 'prompt',
      blocks: [{ type: 'text', text: 'fail' }],
    });
    const begun = nullthrow(client.latestGraphChange(sessionId));
    const graph = await vi.waitFor(async () => {
      const snapshot = await client.getConversationGraph(sessionId);
      const turn = snapshot.turns.find((candidate) => candidate.turnId === failing.turnId);
      if (turn?.state !== 'failed') throw new Error('not failed yet');
      return snapshot;
    });
    expect(graph.turns.find((turn) => turn.turnId === failing.turnId)?.siblingOrdinal).toBe(1);
    expect(client.latestGraphChange(sessionId)).toEqual({
      graphRevision: begun.graphRevision,
      activeLeafTurnId: begun.activeLeafTurnId,
    });
    client.dispose();
  });

  it('refuses a prompt before dispatch: the tree gains a failed sibling, the default leaf stays', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    client.attachSession(sessionId);
    const echoes: string[] = [];
    client.subscribe(sessionId, (entry) => {
      if (entry.event.type === 'user-message') echoes.push(entry.event.messageId);
    });
    const a = await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const b = await client.submitTurn(sessionId, { type: 'shell-command', command: 'b' });
    let graph = await client.getConversationGraph(sessionId);

    await expect(
      client.submitTurn(
        sessionId,
        { type: 'prompt', blocks: [{ type: 'text', text: 'refuse' }] },
        { parentTurnId: a.turnId, expectedGraphRevision: graph.graphRevision },
      ),
    ).rejects.toMatchObject({ code: 'operation_failed' });

    expect(client.latestGraphChange(sessionId)).toEqual({
      graphRevision: graph.graphRevision + 1,
      activeLeafTurnId: b.turnId,
    });
    graph = await client.getConversationGraph(sessionId);
    const refused = nullthrow(
      graph.turns.find((turn) => turn.parentTurnId === a.turnId && turn.siblingOrdinal === 2),
    );
    expect(refused.state).toBe('failed');
    expect(graph.activeLeafTurnId).toBe(b.turnId);
    expect(echoes).not.toContain(userRowMessageId(refused.turnId));
    // Its lineage reads as the shared prefix plus its own prompt row — no placeholder: nothing ran.
    const read = await client.readConversation(sessionId, { leafTurnId: refused.turnId });
    expect(userTexts(read.events)).toEqual(['$ a', 'refuse']);
    expect(read.events.some((item) => !('event' in item) && item.turnId === refused.turnId)).toBe(
      false,
    );
    client.dispose();
  });

  it('settles a cancelled prompt as cancelled and re-announces the tree at its revision', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    client.attachSession(sessionId);
    const running = await client.submitTurn(sessionId, {
      type: 'prompt',
      blocks: [{ type: 'text', text: 'slow reply' }],
    });
    const begun = nullthrow(client.latestGraphChange(sessionId));
    await client.send(sessionId, { type: 'cancel' });
    await vi.waitFor(async () => {
      const snapshot = await client.getConversationGraph(sessionId);
      const turn = snapshot.turns.find((candidate) => candidate.turnId === running.turnId);
      if (turn?.state !== 'cancelled') throw new Error('not cancelled yet');
    });
    expect(client.latestGraphChange(sessionId)).toEqual({
      graphRevision: begun.graphRevision,
      activeLeafTurnId: running.turnId,
    });
    client.dispose();
  });

  it('forks a live child through a turn, copying the lineage and leaving the source alone', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const a = await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const b = await client.submitTurn(sessionId, { type: 'shell-command', command: 'b' });
    const graph = await client.getConversationGraph(sessionId);

    const { sessionId: childId } = await client.forkSession(
      sessionId,
      a.turnId,
      graph.graphRevision,
    );

    expect(childId).not.toBe(sessionId);
    const sessions = await client.listSessions();
    const child = nullthrow(sessions.find((session) => session.sessionId === childId));
    expect(child).toMatchObject({
      kind: 'codex',
      cwd: '/mock/repo',
      status: 'idle',
      forkOrigin: { sourceSessionId: sessionId, sourceTurnId: a.turnId },
    });
    const childGraph = await client.getConversationGraph(childId);
    expect(childGraph.turns).toHaveLength(1);
    const [copy] = childGraph.turns;
    expect(copy.turnId).not.toBe(a.turnId);
    expect(copy).toMatchObject({ parentTurnId: null, siblingOrdinal: 1, state: 'completed' });
    expect(childGraph.activeLeafTurnId).toBe(copy.turnId);
    expect(userTexts((await client.readConversation(childId)).events)).toEqual(['$ a']);
    // The source keeps both turns and its leaf; a replayed operation answers with the same child.
    const source = await client.getConversationGraph(sessionId);
    expect(source.turns).toHaveLength(2);
    expect(source.activeLeafTurnId).toBe(b.turnId);
    expect(source.graphRevision).toBe(graph.graphRevision);
    client.dispose();
  });

  it('refuses a fork through an unknown or stale turn and on a harness without forkAfterTurn', async () => {
    const client = new LinkCodeClient(createDevMockTransport());
    await client.connect();
    const seeded = (await client.listSessions()).length;
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const a = await client.submitTurn(sessionId, { type: 'shell-command', command: 'a' });
    const graph = await client.getConversationGraph(sessionId);

    await expect(
      client.forkSession(sessionId, 'turn-nope' as TurnId, graph.graphRevision),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      client.forkSession(sessionId, a.turnId, graph.graphRevision - 1),
    ).rejects.toMatchObject({ code: 'conflict' });

    const opencode = await client.startSession({ kind: 'opencode', cwd: '/mock/repo' });
    const o = await client.submitTurn(opencode, { type: 'shell-command', command: 'o' });
    const opencodeGraph = await client.getConversationGraph(opencode);
    await expect(
      client.forkSession(opencode, o.turnId, opencodeGraph.graphRevision),
    ).rejects.toMatchObject({ code: 'unsupported' });
    // Nothing forked: only the two sessions this test started joined the seeded list.
    expect(await client.listSessions()).toHaveLength(seeded + 2);
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
