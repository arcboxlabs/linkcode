import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Account } from '@linkcode/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderConfigStore } from '../provider-store';
import { createInMemoryVault } from './fixtures/in-memory-vault';

const fsMocks = vi.hoisted(() => ({
  openTargets: new Map<number, string>(),
  renameTarget: null as string | null,
  renameTargets: [] as string[],
  syncTargets: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    closeSync(descriptor: number) {
      try {
        actual.closeSync(descriptor);
      } finally {
        fsMocks.openTargets.delete(descriptor);
      }
    },
    fsyncSync(descriptor: number) {
      fsMocks.syncTargets.push(fsMocks.openTargets.get(descriptor) ?? '');
      actual.fsyncSync(descriptor);
    },
    openSync(
      path: Parameters<typeof actual.openSync>[0],
      flags: Parameters<typeof actual.openSync>[1],
      mode?: Parameters<typeof actual.openSync>[2],
    ) {
      const descriptor = actual.openSync(path, flags, mode);
      fsMocks.openTargets.set(descriptor, String(path));
      return descriptor;
    },
    renameSync(
      oldPath: Parameters<typeof actual.renameSync>[0],
      newPath: Parameters<typeof actual.renameSync>[1],
    ) {
      const target = String(newPath);
      fsMocks.renameTargets.push(target);
      if (target === fsMocks.renameTarget) throw new Error('simulated rename failure');
      actual.renameSync(oldPath, newPath);
    },
  };
});

const oauthAccount: Account = {
  id: 'acc_oauth',
  label: 'Subscription',
  credential: { type: 'oauth', agent: 'claude-code' },
  createdAt: 0,
};

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-config-persistence-'));
  process.env.LINKCODE_CHANNEL = 'release';
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  fsMocks.renameTarget = null;
  fsMocks.renameTargets = [];
  fsMocks.openTargets.clear();
  fsMocks.syncTargets = [];
  vi.restoreAllMocks();
});

function paths(): { dir: string; config: string } {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  return { dir, config: join(dir, 'config.json') };
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(paths().config, 'utf8')) as Record<string, unknown>;
}

describe('provider config persistence', () => {
  it('atomically replaces providers and accounts, preserves other fields, and tightens the mode', () => {
    const { dir, config } = paths();
    mkdirSync(dir, { recursive: true });
    writeFileSync(config, JSON.stringify({ hostname: '127.0.0.2' }));
    chmodSync(config, 0o644);
    const store = createProviderConfigStore(createInMemoryVault(), {}, []);

    store.update({
      providers: { codex: { enabled: true, activeAccountId: oauthAccount.id } },
      accounts: [oauthAccount],
    });

    expect(readConfig()).toEqual({
      hostname: '127.0.0.2',
      providers: { codex: { enabled: true, activeAccountId: oauthAccount.id } },
      accounts: [oauthAccount],
    });
    expect(store.get()).toEqual({
      codex: { enabled: true, activeAccountId: oauthAccount.id },
    });
    expect(store.getAccounts()).toEqual([oauthAccount]);
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(fsMocks.renameTargets).toEqual([config]);
    expect(fsMocks.syncTargets[0]).toContain(join(dir, '.config.'));
    expect(fsMocks.syncTargets[0]?.endsWith('.tmp')).toBe(true);
    expect(fsMocks.syncTargets.slice(1)).toEqual(process.platform === 'win32' ? [] : [dir]);
  });

  it('rejects corrupt JSON without replacing the file or publishing memory', () => {
    const { dir, config } = paths();
    mkdirSync(dir, { recursive: true });
    const corrupt = '{ definitely not JSON';
    writeFileSync(config, corrupt);
    const store = createProviderConfigStore(createInMemoryVault(), {}, []);

    expect(() =>
      store.update({
        providers: { codex: { enabled: true } },
        accounts: [oauthAccount],
      }),
    ).toThrow(`Invalid JSON in daemon config at ${config}`);

    expect(readFileSync(config, 'utf8')).toBe(corrupt);
    expect(store.get()).toEqual({});
    expect(store.getAccounts()).toEqual([]);
  });

  it('leaves the previous file and memory unchanged when rename fails', () => {
    const { dir, config } = paths();
    mkdirSync(dir, { recursive: true });
    const previous = `${JSON.stringify({ providers: {}, accounts: [] }, null, 2)}\n`;
    writeFileSync(config, previous);
    const store = createProviderConfigStore(createInMemoryVault(), {}, []);
    fsMocks.renameTarget = config;

    expect(() =>
      store.update({
        providers: { codex: { enabled: true } },
        accounts: [oauthAccount],
      }),
    ).toThrow('simulated rename failure');

    expect(readFileSync(config, 'utf8')).toBe(previous);
    expect(store.get()).toEqual({});
    expect(store.getAccounts()).toEqual([]);
    expect(readdirSync(dir).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });
});
