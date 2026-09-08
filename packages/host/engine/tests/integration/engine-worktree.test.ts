import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  SessionId,
  StartOptions,
  TurnId,
  WirePayload,
} from '@linkcode/schema';
import { OperationIdSchema } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionHarness,
  FakeAdapter,
  settleEngineTasks,
  startedSessionId,
} from '../../src/__tests__/fixtures/session-harness';
import type { SessionStore } from '../../src/session/session-store';
import { InMemorySessionStore } from '../../src/session/session-store';
import { InMemoryWorkspaceStore } from '../../src/workspace/workspace-store';
import { InMemoryWorktreeStore } from '../../src/worktree/worktree-store';

const SOURCE_HISTORY = asHistoryId('native-1');
const CHILD_HISTORY = asHistoryId('native-child');

const tempRoots: string[] = [];

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'linkcode-engine-worktree-'));
  tempRoots.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

function makeRepo(): string {
  const path = makeTempDir();
  const remote = makeTempDir();
  git(remote, 'init', '--bare');
  git(path, 'init', '-b', 'main');
  git(
    path,
    '-c',
    'user.email=test@test',
    '-c',
    'user.name=test',
    'commit',
    '--allow-empty',
    '-m',
    'init',
  );
  git(path, 'branch', 'feature');
  git(path, 'remote', 'add', 'origin', remote);
  git(path, 'push', '--all', '--set-upstream', 'origin');
  return path;
}

class RejectingStartAdapter extends FakeAdapter {
  override start(options: StartOptions): Promise<void> {
    this.startedWith = options;
    return Promise.reject(new Error('private adapter failure'));
  }
}

class ForkingAdapter extends FakeAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
    forkAfterTurn: true,
    branch: true,
  };

  branchHistory(_opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void> {
    this.startedWith = startOpts;
    this.emit({ type: 'session-ref', historyId: CHILD_HISTORY });
    return Promise.resolve();
  }
}

type Harness = ReturnType<typeof createSessionHarness>;

function worktreeHarness(
  makeAdapter: () => FakeAdapter,
  stores: {
    sessionStore?: InMemorySessionStore;
    workspaceStore?: InMemoryWorkspaceStore;
    worktreeStore: InMemoryWorktreeStore;
    worktreeRoot: string;
  },
): Harness {
  return createSessionHarness(
    stores.sessionStore ?? new InMemorySessionStore(),
    makeAdapter,
    undefined,
    undefined,
    stores.workspaceStore,
    undefined,
    { worktreeStore: stores.worktreeStore, worktreeRoot: stores.worktreeRoot },
  );
}

async function startOnWorktree(h: Harness, clientReqId: string, repo: string): Promise<SessionId> {
  await h.inject({
    kind: 'session.start',
    clientReqId,
    opts: { kind: 'claude-code', cwd: repo, branch: { name: 'feature', mode: 'worktree' } },
  });
  return vi.waitFor(() => startedSessionId(h.sent, clientReqId));
}

function submitPrompt(h: Harness, clientReqId: string, sessionId: SessionId, text: string) {
  return h.inject({
    kind: 'turn.submit',
    clientReqId,
    sessionId,
    operationId: OperationIdSchema.parse(`op-${clientReqId}`),
    input: { type: 'prompt', blocks: [{ type: 'text', text }] },
  });
}

function submittedTurnId(sent: WirePayload[], replyTo: string): TurnId {
  const reply = sent.find(
    (payload) => payload.kind === 'turn.submitted' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'turn.submitted') throw new Error(`no turn.submitted for ${replyTo}`);
  return reply.turnId;
}

/** One settled turn on the source history with a live `ending` checkpoint. */
async function checkpointedTurn(
  h: Harness,
  adapter: FakeAdapter,
  sessionId: SessionId,
  clientReqId: string,
): Promise<TurnId> {
  await submitPrompt(h, clientReqId, sessionId, clientReqId);
  const turnId = submittedTurnId(h.sent, clientReqId);
  adapter.emit({ type: 'session-ref', historyId: SOURCE_HISTORY });
  adapter.emitCheckpoint({
    historyId: SOURCE_HISTORY,
    cursor: `cp-${clientReqId}`,
    turn: 'ending',
  });
  adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  return turnId;
}

type ForkReply = Extract<WirePayload, { kind: 'session.forked' | 'request.failed' }>;

async function fork(
  h: Harness,
  clientReqId: string,
  sourceSessionId: SessionId,
  throughTurnId: TurnId,
  expectedGraphRevision: number,
): Promise<ForkReply> {
  await h.inject({
    kind: 'session.fork',
    clientReqId,
    sourceSessionId,
    throughTurnId,
    operationId: OperationIdSchema.parse(`op-${clientReqId}`),
    expectedGraphRevision,
  });
  return vi.waitFor(() => {
    const reply = h.sent.find(
      (payload): payload is ForkReply =>
        (payload.kind === 'session.forked' || payload.kind === 'request.failed') &&
        payload.replyTo === clientReqId,
    );
    return nullthrow(reply, `no fork reply for ${clientReqId}`);
  });
}

function requestFailed(sent: WirePayload[], replyTo: string) {
  return vi.waitFor(() => {
    const reply = sent.find(
      (payload) => payload.kind === 'request.failed' && payload.replyTo === replyTo,
    );
    if (reply?.kind !== 'request.failed') throw new Error(`no request.failed for ${replyTo}`);
    return reply;
  });
}

/** The adapter a fork started, as opposed to the throwaway instances capability lookups mint. */
function forkedAdapter(h: Harness, source: FakeAdapter): FakeAdapter {
  return nullthrow(
    h.adapters.find((adapter) => adapter !== source && adapter.startedWith !== null),
    'no forked adapter',
  );
}

/** A settled turn on a live child running on CHILD_HISTORY, checkpointed so a later turn can fork
 * before it. */
async function childCheckpointedTurn(
  h: Harness,
  adapter: FakeAdapter,
  sessionId: SessionId,
  clientReqId: string,
): Promise<void> {
  await submitPrompt(h, clientReqId, sessionId, clientReqId);
  submittedTurnId(h.sent, clientReqId);
  adapter.emitCheckpoint({ historyId: CHILD_HISTORY, cursor: `cp-${clientReqId}`, turn: 'ending' });
  adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
}

/** The live echo of prompt `text` on `sessionId`, carrying the branch cursor a rewrite hands back. */
function liveCursor(sent: WirePayload[], sessionId: SessionId, text: string) {
  const event = sent
    .flatMap((payload) =>
      payload.kind === 'agent.event' && payload.sessionId === sessionId ? [payload.event] : [],
    )
    .findLast(
      (candidate) =>
        candidate.type === 'user-message' &&
        candidate.branchCursor !== undefined &&
        candidate.content[0]?.type === 'text' &&
        candidate.content[0].text === text,
    );
  if (event?.type !== 'user-message' || event.branchCursor === undefined) {
    throw new Error(`no live prompt echo for ${text}`);
  }
  return { sourceMessageId: event.messageId, branchCursor: event.branchCursor };
}

afterEach(() => {
  const drained = tempRoots.splice(0);
  for (let i = 0, len = drained.length; i < len; i++) {
    const root = drained[i];
    rmSync(root, { recursive: true, force: true });
  }
});

describe('engine managed worktree sessions', () => {
  it('deletes a safe managed worktree and its ownership and workspace metadata', async () => {
    const repo = makeRepo();
    const sessionStore = new InMemorySessionStore();
    const workspaceStore = new InMemoryWorkspaceStore();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = createSessionHarness(
      sessionStore,
      undefined,
      undefined,
      undefined,
      workspaceStore,
      undefined,
      { worktreeStore, worktreeRoot: makeTempDir() },
    );
    await h.engine.start();
    try {
      await h.inject({
        kind: 'session.start',
        clientReqId: 'start-delete',
        opts: {
          kind: 'claude-code',
          cwd: repo,
          branch: { name: 'feature', mode: 'worktree' },
        },
      });
      const sessionId = await vi.waitFor(() => startedSessionId(h.sent, 'start-delete'));
      const [record] = (await worktreeStore.load()).worktrees;
      await h.inject({ kind: 'session.delete', clientReqId: 'delete', sessionId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'delete' }),
      );
      expect(existsSync(record.worktreePath)).toBe(false);
      expect(await worktreeStore.load()).toEqual({ worktrees: [], leases: [] });
      expect((await workspaceStore.load()).some(({ cwd }) => cwd === record.worktreePath)).toBe(
        false,
      );
    } finally {
      await h.engine.stop();
    }
  });

  it('does not clean a worktree when durable session deletion fails', async () => {
    const repo = makeRepo();
    const inner = new InMemorySessionStore();
    const sessionStore: SessionStore = {
      load: () => inner.load(),
      save: (record) => inner.save(record),
      delete: () => Promise.reject(new Error('disk unavailable')),
    };
    const worktreeStore = new InMemoryWorktreeStore();
    const h = createSessionHarness(
      sessionStore,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { worktreeStore, worktreeRoot: makeTempDir() },
    );
    await h.engine.start();
    try {
      await h.inject({
        kind: 'session.start',
        clientReqId: 'start-delete-failure',
        opts: {
          kind: 'claude-code',
          cwd: repo,
          branch: { name: 'feature', mode: 'worktree' },
        },
      });
      const sessionId = await vi.waitFor(() => startedSessionId(h.sent, 'start-delete-failure'));
      const [record] = (await worktreeStore.load()).worktrees;

      await h.inject({ kind: 'session.delete', clientReqId: 'delete-failure', sessionId });

      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({
          kind: 'request.failed',
          replyTo: 'delete-failure',
          code: 'operation_failed',
          message: 'Failed to delete session record',
        }),
      );
      expect(existsSync(record.worktreePath)).toBe(true);
      expect(await worktreeStore.load()).toMatchObject({
        worktrees: [{ state: 'active' }],
        leases: [{ sessionId }],
      });
      expect(await inner.load()).toHaveLength(1);
    } finally {
      await h.engine.stop();
    }
  });

  it('keeps a dirty worktree orphaned and removes it at the next boot once it is clean', async () => {
    const repo = makeRepo();
    const workspaceStore = new InMemoryWorkspaceStore();
    const worktreeStore = new InMemoryWorktreeStore();
    const worktreeRoot = makeTempDir();
    const h = worktreeHarness(() => new FakeAdapter(), {
      workspaceStore,
      worktreeStore,
      worktreeRoot,
    });
    await h.engine.start();
    let record: { worktreePath: string };
    try {
      await h.inject({
        kind: 'session.start',
        clientReqId: 'start-retry',
        opts: {
          kind: 'claude-code',
          cwd: repo,
          branch: { name: 'feature', mode: 'worktree' },
        },
      });
      const sessionId = await vi.waitFor(() => startedSessionId(h.sent, 'start-retry'));
      [record] = (await worktreeStore.load()).worktrees;
      const dirtyPath = join(record.worktreePath, 'untracked');
      writeFileSync(dirtyPath, 'dirty');

      await h.inject({ kind: 'session.delete', clientReqId: 'delete-dirty', sessionId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({
          kind: 'request.succeeded',
          replyTo: 'delete-dirty',
        }),
      );
      expect(existsSync(record.worktreePath)).toBe(true);
      expect(await worktreeStore.load()).toMatchObject({
        worktrees: [{ state: 'orphaned' }],
        leases: [],
      });
      rmSync(dirtyPath);
    } finally {
      await h.engine.stop();
    }

    const next = worktreeHarness(() => new FakeAdapter(), {
      workspaceStore,
      worktreeStore,
      worktreeRoot,
    });
    await next.engine.start();
    try {
      expect(existsSync(record.worktreePath)).toBe(false);
      expect(await worktreeStore.load()).toEqual({ worktrees: [], leases: [] });
      expect((await workspaceStore.load()).some(({ cwd }) => cwd === record.worktreePath)).toBe(
        false,
      );
    } finally {
      await next.engine.stop();
    }
  });

  it('starts and resumes in the managed cwd registered under its parent project', async () => {
    const repo = makeRepo();
    const sessionStore = new InMemorySessionStore();
    const workspaceStore = new InMemoryWorkspaceStore();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = createSessionHarness(
      sessionStore,
      undefined,
      undefined,
      undefined,
      workspaceStore,
      undefined,
      { worktreeStore, worktreeRoot: makeTempDir() },
    );
    await h.engine.start();

    try {
      await h.inject({
        kind: 'session.start',
        clientReqId: 'start',
        opts: {
          kind: 'claude-code',
          cwd: repo,
          branch: { name: 'feature', mode: 'worktree' },
        },
      });
      const sessionId = await vi.waitFor(() => startedSessionId(h.sent, 'start'));
      const {
        worktrees: [worktree],
        leases,
      } = await worktreeStore.load();
      const [session] = await sessionStore.load();
      expect(leases).toMatchObject([{ worktreePath: worktree.worktreePath, sessionId }]);
      expect(session.cwd).toBe(worktree.worktreePath);
      expect(h.adapters[0].startedWith).toEqual({
        kind: 'claude-code',
        cwd: worktree.worktreePath,
      });
      const workspaces = await workspaceStore.load();
      const parent = workspaces.find(({ cwd }) => cwd === repo);
      expect(parent?.kind).toBe('project');
      expect(workspaces.find(({ cwd }) => cwd === worktree.worktreePath)).toMatchObject({
        kind: 'worktree',
        name: 'feature',
        parentWorkspaceId: parent?.workspaceId,
      });

      await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'stop' }),
      );
      await h.inject({ kind: 'session.resume', clientReqId: 'resume-success', sessionId });
      await vi.waitFor(() => startedSessionId(h.sent, 'resume-success'));
      expect(h.adapters[1].startedWith).toEqual({
        kind: 'claude-code',
        cwd: worktree.worktreePath,
      });
      await h.inject({ kind: 'session.stop', clientReqId: 'stop-again', sessionId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'stop-again' }),
      );
      rmSync(worktree.worktreePath, { recursive: true, force: true });
      await h.inject({ kind: 'session.resume', clientReqId: 'resume', sessionId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({
          kind: 'request.failed',
          replyTo: 'resume',
          code: 'worktree_missing',
          message: `The managed worktree is missing at ${worktree.worktreePath}. Restore it or delete this session.`,
        }),
      );
    } finally {
      await h.engine.stop();
    }
  });

  it('retains a tracked cold session when adapter startup fails', async () => {
    const repo = makeRepo();
    const sessionStore = new InMemorySessionStore();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = createSessionHarness(
      sessionStore,
      () => new RejectingStartAdapter(),
      undefined,
      undefined,
      undefined,
      undefined,
      { worktreeStore, worktreeRoot: makeTempDir() },
    );
    await h.engine.start();

    try {
      await h.inject({
        kind: 'session.start',
        clientReqId: 'start',
        opts: {
          kind: 'claude-code',
          cwd: repo,
          branch: { name: 'feature', mode: 'worktree' },
        },
      });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({
          kind: 'request.failed',
          replyTo: 'start',
          code: 'operation_failed',
          message: 'Agent failed to start',
        }),
      );
      expect(JSON.stringify(h.sent)).not.toContain('private adapter failure');
      const {
        worktrees: [worktree],
        leases,
      } = await worktreeStore.load();
      const [session] = await sessionStore.load();
      expect(leases).toMatchObject([
        { worktreePath: worktree.worktreePath, sessionId: session.sessionId },
      ]);
      expect(session.cwd).toBe(worktree.worktreePath);
    } finally {
      await h.engine.stop();
    }
  });
});

describe('engine managed worktree leases', () => {
  it('shares the worktree with a fork child and removes it only after the last lease goes', async () => {
    const repo = makeRepo();
    const workspaceStore = new InMemoryWorkspaceStore();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = worktreeHarness(() => new ForkingAdapter(), {
      workspaceStore,
      worktreeStore,
      worktreeRoot: makeTempDir(),
    });
    await h.engine.start();
    try {
      const sourceId = await startOnWorktree(h, 'start', repo);
      const source = nullthrow(h.adapters[0]);
      await checkpointedTurn(h, source, sourceId, 't1');
      const secondTurnId = await checkpointedTurn(h, source, sourceId, 't2');

      const forked = await fork(h, 'fork', sourceId, secondTurnId, 2);
      if (forked.kind !== 'session.forked') throw new Error(`fork failed: ${forked.message}`);
      const childId = forked.sessionId;
      const {
        worktrees: [worktree],
        leases,
      } = await worktreeStore.load();
      expect(leases.map((lease) => lease.sessionId).sort()).toEqual([sourceId, childId].sort());
      expect(new Set(leases.map((lease) => lease.worktreePath))).toEqual(
        new Set([worktree.worktreePath]),
      );
      expect(forkedAdapter(h, source).startedWith).toMatchObject({ cwd: worktree.worktreePath });

      await h.inject({ kind: 'session.delete', clientReqId: 'delete-source', sessionId: sourceId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'delete-source' }),
      );
      expect(existsSync(worktree.worktreePath)).toBe(true);
      expect(await worktreeStore.load()).toMatchObject({
        worktrees: [{ worktreePath: worktree.worktreePath, state: 'active' }],
        leases: [{ sessionId: childId }],
      });
      expect((await workspaceStore.load()).some(({ cwd }) => cwd === worktree.worktreePath)).toBe(
        true,
      );

      await h.inject({ kind: 'session.delete', clientReqId: 'delete-child', sessionId: childId });
      await vi.waitFor(() =>
        expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'delete-child' }),
      );
      expect(existsSync(worktree.worktreePath)).toBe(false);
      expect(await worktreeStore.load()).toEqual({ worktrees: [], leases: [] });
      expect((await workspaceStore.load()).some(({ cwd }) => cwd === worktree.worktreePath)).toBe(
        false,
      );
    } finally {
      await h.engine.stop();
    }
  });

  it('refuses to fork onto a worktree whose removal has begun and abandons the child', async () => {
    const repo = makeRepo();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = worktreeHarness(() => new ForkingAdapter(), {
      worktreeStore,
      worktreeRoot: makeTempDir(),
    });
    await h.engine.start();
    try {
      const sourceId = await startOnWorktree(h, 'start', repo);
      const source = nullthrow(h.adapters[0]);
      const turnId = await checkpointedTurn(h, source, sourceId, 't1');
      // The last lease's release landed durably (another process, or a crash mid-cleanup) while
      // this engine still holds the source's view of the worktree.
      const [worktree] = (await worktreeStore.load()).worktrees;
      await worktreeStore.save({ ...worktree, state: 'deleting' });

      const forked = await fork(h, 'fork', sourceId, turnId, 1);
      expect(forked).toMatchObject({
        kind: 'request.failed',
        code: 'conflict',
        message: 'The managed worktree is being removed',
      });
      expect((await worktreeStore.load()).leases).toMatchObject([{ sessionId: sourceId }]);
      expect(
        h.sent.filter(
          (payload) => payload.kind === 'session.changed' && payload.reason === 'created',
        ),
      ).toHaveLength(1);
      const forkedChild = h.adapters.find(
        (adapter) => adapter !== source && adapter.startedWith !== null,
      );
      expect(forkedChild).toBeUndefined();
    } finally {
      await h.engine.stop();
    }
  });

  it('lets only one leaseholder run a turn at a time', async () => {
    const repo = makeRepo();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = worktreeHarness(() => new ForkingAdapter(), {
      worktreeStore,
      worktreeRoot: makeTempDir(),
    });
    await h.engine.start();
    try {
      const sourceId = await startOnWorktree(h, 'start', repo);
      const source = nullthrow(h.adapters[0]);
      const turnId = await checkpointedTurn(h, source, sourceId, 't1');
      const forked = await fork(h, 'fork', sourceId, turnId, 1);
      if (forked.kind !== 'session.forked') throw new Error(`fork failed: ${forked.message}`);
      const childId = forked.sessionId;

      await submitPrompt(h, 'source-turn', sourceId, 'keep going');
      submittedTurnId(h.sent, 'source-turn');
      source.emit({ type: 'status', status: 'running' });

      await submitPrompt(h, 'child-turn', childId, 'me too');
      expect(await requestFailed(h.sent, 'child-turn')).toMatchObject({
        code: 'busy',
        message: 'Another session on this worktree is running a turn',
      });
      await h.inject({
        kind: 'agent.input',
        clientReqId: 'child-legacy',
        sessionId: childId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'me too' }] },
      });
      expect(await requestFailed(h.sent, 'child-legacy')).toMatchObject({ code: 'busy' });

      source.emitCheckpoint({ historyId: SOURCE_HISTORY, cursor: 'cp-3', turn: 'ending' });
      source.emit({ type: 'status', status: 'idle' });
      await settleEngineTasks();
      await submitPrompt(h, 'child-turn-2', childId, 'now');
      await vi.waitFor(() => submittedTurnId(h.sent, 'child-turn-2'));
      // The child now holds the worktree's turn: the source is the one refused.
      forkedAdapter(h, source).emit({ type: 'status', status: 'running' });
      await submitPrompt(h, 'source-turn-2', sourceId, 'again');
      expect(await requestFailed(h.sent, 'source-turn-2')).toMatchObject({ code: 'busy' });
    } finally {
      await h.engine.stop();
    }
  });

  it('refuses to rewrite a prompt on a worktree whose co-leaseholder is running', async () => {
    const repo = makeRepo();
    const worktreeStore = new InMemoryWorktreeStore();
    const h = worktreeHarness(() => new ForkingAdapter(), {
      worktreeStore,
      worktreeRoot: makeTempDir(),
    });
    await h.engine.start();
    try {
      const sourceId = await startOnWorktree(h, 'start', repo);
      const source = nullthrow(h.adapters[0]);
      const turnId = await checkpointedTurn(h, source, sourceId, 't1');
      const forked = await fork(h, 'fork', sourceId, turnId, 1);
      if (forked.kind !== 'session.forked') throw new Error(`fork failed: ${forked.message}`);
      const childId = forked.sessionId;
      const child = forkedAdapter(h, source);

      // The child runs two live turns of its own so its second prompt has a bound cut to rewrite.
      await childCheckpointedTurn(h, child, childId, 'k1');
      await childCheckpointedTurn(h, child, childId, 'k2');
      const rewriteTarget = liveCursor(h.sent, childId, 'k2');

      // The source holds the worktree's running turn.
      await submitPrompt(h, 'source-run', sourceId, 'keep going');
      submittedTurnId(h.sent, 'source-run');
      source.emit({ type: 'status', status: 'running' });

      await h.inject({
        kind: 'history.branch',
        clientReqId: 'rewrite',
        sourceSessionId: childId,
        ...rewriteTarget,
        content: [{ type: 'text', text: 'k2, edited' }],
      });
      expect(await requestFailed(h.sent, 'rewrite')).toMatchObject({
        code: 'busy',
        message: 'Another session on this worktree is running a turn',
      });
    } finally {
      await h.engine.stop();
    }
  });

  it('sweeps a lease whose session is gone at boot and finishes the cleanup', async () => {
    const repo = makeRepo();
    const worktreeStore = new InMemoryWorktreeStore();
    const worktreeRoot = makeTempDir();
    const first = worktreeHarness(() => new FakeAdapter(), { worktreeStore, worktreeRoot });
    await first.engine.start();
    let worktreePath: string;
    try {
      await startOnWorktree(first, 'start', repo);
      worktreePath = (await worktreeStore.load()).worktrees[0].worktreePath;
    } finally {
      await first.engine.stop();
    }
    expect(existsSync(worktreePath)).toBe(true);
    expect((await worktreeStore.load()).leases).toHaveLength(1);

    // The session store the next boot reads never held that session.
    const second = worktreeHarness(() => new FakeAdapter(), { worktreeStore, worktreeRoot });
    await second.engine.start();
    try {
      expect(existsSync(worktreePath)).toBe(false);
      expect(await worktreeStore.load()).toEqual({ worktrees: [], leases: [] });
    } finally {
      await second.engine.stop();
    }
  });
});
