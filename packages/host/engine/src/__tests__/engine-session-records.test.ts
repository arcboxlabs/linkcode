import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentHistoryReadOptions,
  SessionId,
  SessionRecord,
  WorkspaceId,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { SessionStore } from '../session/session-store';
import { InMemorySessionStore } from '../session/session-store';
import { InMemoryWorkspaceStore } from '../workspace/workspace-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  listedSessions,
  startedSessionId as startedId,
} from './fixtures/session-harness';

class CwdlessHistoryAdapter extends FakeAdapter {
  override readHistory(opts: AgentHistoryReadOptions) {
    return Promise.resolve({
      session: {
        historyId: opts.historyId,
        kind: this.kind,
        title: 'Imported title',
        createdAt: 1111,
      },
      events: [],
    });
  }
}

function listedWorkspaces(sent: Parameters<typeof listedSessions>[0], replyTo: string) {
  const listed = sent.find(
    (payload) => payload.kind === 'workspace.listed' && payload.replyTo === replyTo,
  );
  if (listed?.kind !== 'workspace.listed') throw new Error(`no workspace.listed for ${replyTo}`);
  return listed.workspaces;
}

describe('engine session records', () => {
  it('persists created sessions with title and session-ref, and lists them cold after a restart', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('  Fix the   flaky\ntest  ')] },
    });

    const records = await store.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(sessionId);
    expect(records[0].origin).toEqual({ type: 'created' });
    expect(records[0].title).toBe('Fix the flaky test');
    expect(records[0].runs).toHaveLength(1);
    expect(records[0].runs[0].historyId).toBe('native-1');

    // A fresh engine over the same store lists the session cold.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.list', clientReqId: 'r3' });
    const sessions = listedSessions(second.sent, 'r3');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      status: 'stopped',
      title: 'Fix the flaky test',
      cwd: '/repo',
      historyId: 'native-1',
    });
    expect(sessions[0].updatedAt).toBeTypeOf('number');
  });

  it('resumes a persisted session under the same id, appending a run', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(second.sent, 'r3')).toBe(sessionId);
    expect(second.adapters[0].resumedFrom).toBe('native-1');

    const [record] = await store.load();
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0].endedAt).toBeTypeOf('number');
    expect(record.runs[1].historyId).toBe('native-1');
  });

  it('imports a provider history session as a cold record', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    const imported = sent.find((p) => p.kind === 'session.imported');
    if (imported?.kind !== 'session.imported') throw new Error('no session.imported reply');
    expect(imported.record).toMatchObject({
      kind: 'claude-code',
      cwd: '/imported',
      title: 'Imported title',
      origin: { type: 'imported', historyId: 'native-9' },
      createdAt: 1111,
      runs: [],
    });

    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')[0].status).toBe('stopped');

    await inject({ kind: 'workspace.list', clientReqId: 'r3' });
    expect(listedWorkspaces(sent, 'r3')).toEqual([
      expect.objectContaining({ cwd: '/imported', name: 'imported', kind: 'project' }),
    ]);
  });

  it('serializes concurrent imports of the same provider history', async () => {
    const store = new InMemorySessionStore();
    const { engine, sent, inject } = harness(store);
    await engine.start();
    const request = {
      kind: 'session.import' as const,
      agentKind: 'claude-code' as const,
      historyId: asHistoryId('native-9'),
    };

    await Promise.all([
      inject({ ...request, clientReqId: 'r1' }),
      inject({ ...request, clientReqId: 'r2' }),
    ]);

    const imported = sent.filter((payload) => payload.kind === 'session.imported');
    expect(imported).toHaveLength(2);
    expect(new Set(imported.map((payload) => payload.record.sessionId)).size).toBe(1);
    expect(await store.load()).toHaveLength(1);
  });

  it('does not register a workspace when imported history has no cwd', async () => {
    const h = harness(new InMemorySessionStore(), () => new CwdlessHistoryAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    await h.inject({ kind: 'workspace.list', clientReqId: 'r2' });
    expect(listedWorkspaces(h.sent, 'r2')).toEqual([]);
  });

  it('keeps an existing registered workspace when importing history from its cwd', async () => {
    const workspaceStore = new InMemoryWorkspaceStore();
    await workspaceStore.save({
      workspaceId: 'ws-existing' as WorkspaceId,
      cwd: '/imported',
      name: 'Custom project name',
      kind: 'project',
      createdAt: 1,
      lastUsedAt: 1,
    });
    const h = harness(undefined, undefined, undefined, undefined, workspaceStore);
    await h.engine.start();
    await h.inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    await h.inject({ kind: 'workspace.list', clientReqId: 'r2' });
    expect(listedWorkspaces(h.sent, 'r2')).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-existing',
        cwd: '/imported',
        name: 'Custom project name',
      }),
    ]);
  });

  it('backfills projects for existing imported sessions without changing created sessions', async () => {
    const sessionStore = new InMemorySessionStore();
    const imported: SessionRecord = {
      sessionId: 's-imported' as SessionId,
      kind: 'claude-code',
      cwd: '/legacy/imported-project',
      title: 'Imported title',
      origin: { type: 'imported', historyId: asHistoryId('native-9'), importedAt: 2 },
      createdAt: 1,
      updatedAt: 2,
      runs: [],
    };
    const created: SessionRecord = {
      sessionId: 's-created' as SessionId,
      kind: 'claude-code',
      cwd: '/legacy/created-project',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 2,
      runs: [],
    };
    await sessionStore.save(imported);
    await sessionStore.save(created);

    const h = harness(sessionStore);
    await h.engine.start();
    await h.inject({ kind: 'workspace.list', clientReqId: 'r1' });

    expect(listedWorkspaces(h.sent, 'r1')).toEqual([
      expect.objectContaining({ cwd: '/legacy/imported-project', name: 'imported-project' }),
    ]);
  });

  it('retries an imported session after its first durable save fails', async () => {
    const inner = new InMemorySessionStore();
    let shouldFail = true;
    const store: SessionStore = {
      load: () => inner.load(),
      save: (record) => {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error('private database detail'));
        }
        return inner.save(record);
      },
      delete: (sessionId) => inner.delete(sessionId),
    };
    const { engine, sent, inject } = harness(store);
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'operation_failed',
      message: 'Failed to persist session record',
    });
    expect(
      sent.some((payload) => JSON.stringify(payload).includes('private database detail')),
    ).toBe(false);
    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')).toEqual([]);

    await inject({
      kind: 'session.import',
      clientReqId: 'r3',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });
    await inject({ kind: 'session.list', clientReqId: 'r4' });
    expect(listedSessions(sent, 'r4')).toHaveLength(1);
    expect(await inner.load()).toHaveLength(1);
  });
});
