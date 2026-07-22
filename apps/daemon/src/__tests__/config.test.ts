import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  daemonProfile,
  databasePath,
  hqCredentialsPath,
  loadConfig,
  runtimeFilePath,
} from '../config';
import { logger } from '../logger';
import { telemetryConfigCachePath } from '../paths';

let savedHome: string | undefined;

// loadConfig() reads ~/.linkcode/config.json; point HOME at a fresh temp dir per test.
beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-config-'));
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_PROFILE;
  vi.restoreAllMocks();
});

function writeConfig(providers: unknown): void {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ providers }));
}

function writeAccountsConfig(accounts: unknown): void {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ accounts }));
}

const validAccount = {
  id: 'acc_1',
  label: 'Personal key',
  credential: { type: 'api-key', key: 'sk-test' },
  createdAt: 0,
};

describe('loadConfig providers', () => {
  it('keeps valid provider entries and drops an invalid one, logging the error', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig({
      'claude-code': { enabled: true, defaultModel: 'sonnet' },
      codex: { enabled: 'not-a-boolean' },
    });

    const config = loadConfig();

    expect(config.providers).toEqual({
      'claude-code': { enabled: true, defaultModel: 'sonnet' },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('drops an entry keyed by an unknown agent kind, logging the error', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig({
      'claude-code': { enabled: true },
      'not-a-real-agent': { enabled: true },
    });

    const config = loadConfig();

    expect(config.providers).toEqual({
      'claude-code': { enabled: true },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls back to an empty object when providers is not an object', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig('nonsense');

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it('defaults to an empty object without logging when providers is absent', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig(undefined);
    // JSON.stringify drops an `undefined` value entirely, so the field is simply missing.

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('profile-scoped state paths', () => {
  it('resolves under ~/.linkcode for the default profile', () => {
    expect(daemonProfile()).toBeUndefined();
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode', 'daemon.db'));
  });

  it('forks every state path into the profile sibling directory', () => {
    process.env.LINKCODE_PROFILE = 'alpha';
    const root = join(process.env.HOME ?? '', '.linkcode-alpha');
    expect(daemonProfile()).toBe('alpha');
    expect(databasePath()).toBe(join(root, 'daemon.db'));
    expect(runtimeFilePath()).toBe(join(root, 'runtime.json'));
    expect(hqCredentialsPath()).toBe(join(root, 'hq.json'));
    expect(telemetryConfigCachePath()).toBe(join(root, 'telemetry-config.json'));
  });

  it('treats an empty LINKCODE_PROFILE as the default profile', () => {
    process.env.LINKCODE_PROFILE = '';
    expect(daemonProfile()).toBeUndefined();
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode', 'daemon.db'));
  });

  it('aborts on an invalid profile name instead of using the default universe', () => {
    process.env.LINKCODE_PROFILE = 'Not_Valid!';
    expect(() => daemonProfile()).toThrow(TypeError);
    expect(() => databasePath()).toThrow(TypeError);
  });

  it('rejects a path-traversal profile instead of resolving outside the home sibling', () => {
    process.env.LINKCODE_PROFILE = '../evil';
    expect(() => runtimeFilePath()).toThrow(TypeError);
    expect(() => databasePath()).toThrow(TypeError);
  });
});

describe('loadConfig accounts', () => {
  it('keeps valid accounts and drops an invalid one, logging the error', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig([
      validAccount,
      // Missing the api-key `key` — fails the credential union.
      { id: 'acc_2', label: 'Bad', credential: { type: 'api-key' }, createdAt: 0 },
    ]);

    const config = loadConfig();

    expect(config.accounts).toEqual([validAccount]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls back to an empty array when accounts is not an array', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig({ not: 'an array' });

    const config = loadConfig();

    expect(config.accounts).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('defaults to an empty array without logging when accounts is absent', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig(undefined);

    const config = loadConfig();

    expect(config.accounts).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
