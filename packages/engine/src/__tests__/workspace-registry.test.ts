import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRegistry } from '../workspace-registry';
import { InMemoryWorkspaceStore } from '../workspace-store';

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
      const second = registry.touch('repo');
      expect(second.workspaceId).toBe(first.workspaceId);
      expect(registry.list()).toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('touch() auto-registers an unknown cwd and freshens lastUsedAt monotonically for a known one', () => {
    const registry = new WorkspaceRegistry();
    const created = registry.touch('/repo');
    expect(created.createdAt).toBe(1000);
    expect(created.lastUsedAt).toBe(1000);
    expect(created.name).toBe('repo');

    vi.setSystemTime(2000);
    const touched = registry.touch('/repo');
    expect(touched.workspaceId).toBe(created.workspaceId);
    expect(touched.createdAt).toBe(1000);
    expect(touched.lastUsedAt).toBe(2000);
    expect(touched.lastUsedAt).toBeGreaterThan(created.createdAt);
  });

  it('list() sorts by lastUsedAt descending', () => {
    const registry = new WorkspaceRegistry();
    registry.touch('/a');
    vi.setSystemTime(2000);
    registry.touch('/b');
    vi.setSystemTime(3000);
    registry.touch('/c');
    // Freshen /a so it jumps back to the front.
    vi.setSystemTime(4000);
    registry.touch('/a');

    expect(registry.list().map((record) => record.cwd)).toEqual(['/a', '/c', '/b']);
  });

  it('update() renames a workspace by id', () => {
    const registry = new WorkspaceRegistry();
    const record = registry.touch('/repo');
    const updated = registry.update(record.workspaceId, 'My Repo');
    expect(updated.name).toBe('My Repo');
    expect(registry.list()[0].name).toBe('My Repo');
  });

  it('update() rejects an unknown workspace id', () => {
    const registry = new WorkspaceRegistry();
    expect(() => registry.update('ws-missing' as WorkspaceId, 'x')).toThrow('Unknown workspace');
  });

  it('archive() removes the workspace from the registry only, and is a noop for an unknown id', () => {
    const registry = new WorkspaceRegistry();
    const record = registry.touch('/repo');
    registry.archive(record.workspaceId);
    expect(registry.list()).toHaveLength(0);
    // Re-registering the same directory creates a fresh record rather than resurrecting the old one.
    const recreated = registry.touch('/repo');
    expect(recreated.workspaceId).not.toBe(record.workspaceId);

    expect(() => registry.archive('ws-missing' as WorkspaceId)).not.toThrow();
  });

  it('start() restores the index from the injected store', async () => {
    const dir = makeTempDir();
    const store = new InMemoryWorkspaceStore();
    const seed = new WorkspaceRegistry(store);
    seed.touch(dir);

    const restored = new WorkspaceRegistry(store);
    await restored.start();
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0].cwd).toBe(dir);

    // The restored index still dedupes against the recovered key.
    const touchedAgain = await restored.register({ cwd: dir });
    expect(touchedAgain.workspaceId).toBe(restored.list()[0].workspaceId);
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
