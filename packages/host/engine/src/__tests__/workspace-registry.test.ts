import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRegistry } from '../workspace/workspace-registry';
import { InMemoryWorkspaceStore } from '../workspace/workspace-store';

function makeRecord(value: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    workspaceId: 'ws-1' as WorkspaceId,
    cwd: '/repo',
    name: 'repo',
    createdAt: 1,
    lastUsedAt: 1,
    ...value,
  };
}

// register() now stats its cwd, so tests exercising it need a real directory — touch() has no such
// requirement and keeps using arbitrary paths.
const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-workspace-registry-test-'));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WorkspaceRegistry', () => {
  it('register() is idempotent across a trailing separator', async () => {
    const registry = new WorkspaceRegistry();
    const dir = makeTempDir();
    const first = await registry.register({ cwd: dir });
    const second = await registry.register({ cwd: `${dir}/` });
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(registry.list()).toHaveLength(1);
  });

  it('register() rejects a cwd that does not exist', async () => {
    const registry = new WorkspaceRegistry();
    const missing = join(makeTempDir(), 'does-not-exist');
    await expect(registry.register({ cwd: missing })).rejects.toThrow(
      'Workspace directory does not exist',
    );
    expect(registry.list()).toHaveLength(0);
  });

  it('register() rejects a cwd that is not a directory', async () => {
    const registry = new WorkspaceRegistry();
    const file = join(makeTempDir(), 'file.txt');
    writeFileSync(file, '');
    await expect(registry.register({ cwd: file })).rejects.toThrow(
      'Workspace path is not a directory',
    );
    expect(registry.list()).toHaveLength(0);
  });

  it('touch() resolves a relative cwd to the same record as an absolute register() cwd', async () => {
    const registry = new WorkspaceRegistry();
    const root = makeTempDir();
    mkdirSync(join(root, 'repo'));
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const absolute = resolve(process.cwd(), 'repo');
      const first = await registry.register({ cwd: absolute });
      const second = await registry.touch('repo');
      expect(second.workspaceId).toBe(first.workspaceId);
      expect(registry.list()).toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('touch() auto-registers an unknown cwd and freshens lastUsedAt monotonically for a known one', async () => {
    const registry = new WorkspaceRegistry();
    const created = await registry.touch('/repo');
    expect(created.createdAt).toBe(1000);
    expect(created.lastUsedAt).toBe(1000);
    expect(created.name).toBe('repo');

    vi.setSystemTime(2000);
    const touched = await registry.touch('/repo');
    expect(touched.workspaceId).toBe(created.workspaceId);
    expect(touched.createdAt).toBe(1000);
    expect(touched.lastUsedAt).toBe(2000);
    expect(touched.lastUsedAt).toBeGreaterThan(created.createdAt);
  });

  it('list() sorts by lastUsedAt descending', async () => {
    const registry = new WorkspaceRegistry();
    await registry.touch('/a');
    vi.setSystemTime(2000);
    await registry.touch('/b');
    vi.setSystemTime(3000);
    await registry.touch('/c');
    // Freshen /a so it jumps back to the front.
    vi.setSystemTime(4000);
    await registry.touch('/a');

    expect(registry.list().map((record) => record.cwd)).toEqual(['/a', '/c', '/b']);
  });

  it('update() renames a workspace by id', async () => {
    const registry = new WorkspaceRegistry();
    const record = await registry.touch('/repo');
    const updated = await registry.update(record.workspaceId, 'My Repo');
    expect(updated.name).toBe('My Repo');
    expect(registry.list()[0].name).toBe('My Repo');
  });

  it('update() rejects an unknown workspace id', async () => {
    const registry = new WorkspaceRegistry();
    await expect(registry.update('ws-missing' as WorkspaceId, 'x')).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'not_found',
    });
  });

  it('archive() removes the workspace from the registry only, and is a noop for an unknown id', async () => {
    const registry = new WorkspaceRegistry();
    const record = await registry.touch('/repo');
    await registry.archive(record.workspaceId);
    expect(registry.list()).toHaveLength(0);
    // Re-registering the same directory creates a fresh record rather than resurrecting the old one.
    const recreated = await registry.touch('/repo');
    expect(recreated.workspaceId).not.toBe(record.workspaceId);

    await expect(registry.archive('ws-missing' as WorkspaceId)).resolves.toBeUndefined();
  });

  it('start() restores the index from the injected store', async () => {
    const dir = makeTempDir();
    const store = new InMemoryWorkspaceStore();
    const seed = new WorkspaceRegistry(store);
    await seed.touch(dir);

    const restored = new WorkspaceRegistry(store);
    await restored.start();
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0].cwd).toBe(dir);

    // The restored index still dedupes against the recovered key.
    const touchedAgain = await restored.register({ cwd: dir });
    expect(touchedAgain.workspaceId).toBe(restored.list()[0].workspaceId);
  });

  it('does not index a workspace when persistence fails', async () => {
    const store = new InMemoryWorkspaceStore();
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk unavailable'));
    const registry = new WorkspaceRegistry(store);

    await expect(registry.touch('/repo')).rejects.toMatchObject({
      _tag: 'OperationError',
      subsystem: 'store',
      operation: 'workspace.save',
    });
    expect(registry.list()).toEqual([]);
  });

  it('keeps the prior name when persistence fails during update', async () => {
    const store = new InMemoryWorkspaceStore();
    const registry = new WorkspaceRegistry(store);
    const record = await registry.touch('/repo');
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(registry.update(record.workspaceId, 'Renamed')).rejects.toMatchObject({
      _tag: 'OperationError',
      operation: 'workspace.save',
    });
    expect(registry.list()[0].name).toBe('repo');
  });

  it('keeps a workspace indexed when persisted deletion fails', async () => {
    const store = new InMemoryWorkspaceStore();
    const registry = new WorkspaceRegistry(store);
    const record = await registry.touch('/repo');
    vi.spyOn(store, 'delete').mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(registry.archive(record.workspaceId)).rejects.toMatchObject({
      _tag: 'OperationError',
      operation: 'workspace.delete',
    });
    expect(registry.list()).toEqual([record]);
  });
});

describe('WorkspaceRegistry chat workspace', () => {
  it('ensureChatWorkspace() creates the directory and registers a fresh chat workspace', async () => {
    const registry = new WorkspaceRegistry();
    const chatDir = join(makeTempDir(), 'LinkCode');

    const record = await registry.ensureChatWorkspace(chatDir);

    expect(existsSync(chatDir)).toBe(true);
    expect(record.kind).toBe('chat');
    expect(registry.list()).toEqual([record]);
  });

  it('ensureChatWorkspace() is idempotent for an already-chat directory', async () => {
    const registry = new WorkspaceRegistry();
    const chatDir = makeTempDir();

    const first = await registry.ensureChatWorkspace(chatDir);
    const second = await registry.ensureChatWorkspace(chatDir);

    expect(second).toEqual(first);
    expect(registry.list()).toHaveLength(1);
  });

  it('ensureChatWorkspace() upgrades an existing project record to chat in place', async () => {
    const registry = new WorkspaceRegistry();
    const chatDir = makeTempDir();
    const registered = await registry.register({ cwd: chatDir });
    expect(registered.kind).toBe('project');

    const upgraded = await registry.ensureChatWorkspace(chatDir);

    expect(upgraded.workspaceId).toBe(registered.workspaceId);
    expect(upgraded.kind).toBe('chat');
    expect(registry.list()).toHaveLength(1);
  });

  it('touch() auto-registers the chat root as kind chat, and any other cwd as project', async () => {
    const registry = new WorkspaceRegistry();
    const chatDir = makeTempDir();
    await registry.ensureChatWorkspace(chatDir);

    expect((await registry.touch(chatDir)).kind).toBe('chat');
    expect((await registry.touch('/some/other/repo')).kind).toBe('project');
  });

  it('archive() rejects the chat workspace', async () => {
    const registry = new WorkspaceRegistry();
    const chat = await registry.ensureChatWorkspace(makeTempDir());

    await expect(registry.archive(chat.workspaceId)).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'conflict',
    });
    expect(registry.list()).toEqual([chat]);
  });

  it('update() rejects renaming the chat workspace', async () => {
    const registry = new WorkspaceRegistry();
    const chat = await registry.ensureChatWorkspace(makeTempDir());

    await expect(registry.update(chat.workspaceId, 'Renamed')).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'conflict',
    });
  });
});

describe('InMemoryWorkspaceStore', () => {
  it('round-trips saved records and deep-clones them', async () => {
    const store = new InMemoryWorkspaceStore();
    const record = makeRecord();
    await store.save(record);
    const [loaded] = await store.load();
    expect(loaded).toEqual(record);
    expect(loaded).not.toBe(record);
  });

  it('delete() removes a record', async () => {
    const store = new InMemoryWorkspaceStore();
    const record = makeRecord();
    await store.save(record);
    await store.delete(record.workspaceId);
    expect(await store.load()).toEqual([]);
  });
});

describe('normalizeCwdKey', () => {
  it('strips a single trailing separator', () => {
    expect(normalizeCwdKey('/repo/')).toBe('/repo');
    expect(normalizeCwdKey('C:\\repo\\')).toBe(String.raw`C:\repo`);
  });

  it('collapses multiple trailing separators', () => {
    expect(normalizeCwdKey('/repo///')).toBe('/repo');
    expect(normalizeCwdKey('C:\\repo\\\\')).toBe(String.raw`C:\repo`);
  });

  it('preserves a bare root instead of collapsing it away', () => {
    expect(normalizeCwdKey('/')).toBe('/');
    expect(normalizeCwdKey('///')).toBe('/');
    expect(normalizeCwdKey('C:\\')).toBe('C:\\');
    expect(normalizeCwdKey('C:\\\\')).toBe('C:\\');
  });

  it('leaves a cwd with no trailing separator untouched', () => {
    expect(normalizeCwdKey('/repo')).toBe('/repo');
    expect(normalizeCwdKey('')).toBe('');
  });
});
