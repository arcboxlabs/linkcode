import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartOptions } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionHarness,
  FakeAdapter,
  startedSessionId,
} from '../../src/__tests__/fixtures/session-harness';
import { InMemorySessionStore } from '../../src/session/session-store';
import { InMemoryWorkspaceStore } from '../../src/workspace/workspace-store';
import { InMemoryWorktreeStore } from '../../src/worktree/worktree-store';

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
  return path;
}

class RejectingStartAdapter extends FakeAdapter {
  override start(options: StartOptions): Promise<void> {
    this.startedWith = options;
    return Promise.reject(new Error('private adapter failure'));
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('engine managed worktree sessions', () => {
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
        opts: { kind: 'claude-code', cwd: repo, branch: { name: 'feature' } },
      });
      const sessionId = await vi.waitFor(() => startedSessionId(h.sent, 'start'));
      const [worktree] = await worktreeStore.load();
      const [session] = await sessionStore.load();
      expect(worktree.sessionId).toBe(sessionId);
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
        opts: { kind: 'claude-code', cwd: repo, branch: { name: 'feature' } },
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
      const [worktree] = await worktreeStore.load();
      const [session] = await sessionStore.load();
      expect(worktree.sessionId).toBe(session.sessionId);
      expect(session.cwd).toBe(worktree.worktreePath);
    } finally {
      await h.engine.stop();
    }
  });
});
