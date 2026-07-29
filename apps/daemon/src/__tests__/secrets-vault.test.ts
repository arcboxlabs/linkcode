import { Buffer } from 'node:buffer';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { createSecretVault } from '../secrets/vault';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const TOKEN = 'sk-ant-super-secret';

let file: string;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'linkcode-vault-')), 'secrets.json');
  vi.spyOn(logger, 'warn').mockImplementation(noop);
  vi.spyOn(logger, 'error').mockImplementation(noop);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function readDocument(): { protection: string; data: unknown } {
  return JSON.parse(readFileSync(file, 'utf8')) as { protection: string; data: unknown };
}

describe('secret vault under an OS keyring', () => {
  it('keeps the secret out of the file and reads it back through the master key', () => {
    createSecretVault(file, KEY).set('hq:session', TOKEN);

    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(readDocument().protection).toBe('os-keyring');
    expect(createSecretVault(file, KEY).get('hq:session')).toBe(TOKEN);
  });

  it('writes the store 0600 — the ciphertext is still a credential envelope', () => {
    createSecretVault(file, KEY).set('hq:session', TOKEN);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('starts empty when the master key no longer matches the ciphertext', () => {
    createSecretVault(file, KEY).set('hq:session', TOKEN);

    // A wiped keyring entry mints a fresh key; the old ciphertext is then unrecoverable, which is a
    // permanent loss to report and reset from, not a transient failure to retry.
    const vault = createSecretVault(file, OTHER_KEY);

    expect(vault.get('hq:session')).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('forgets a deleted secret on disk, not just in memory', () => {
    const vault = createSecretVault(file, KEY);
    vault.set('hq:session', TOKEN);
    vault.delete('hq:session');

    expect(createSecretVault(file, KEY).get('hq:session')).toBeNull();
  });
});

describe('secret vault without a keyring', () => {
  it('persists in the clear, and records on disk that it did', () => {
    // The chosen trade-off (CODE-371): a headless host stays usable across restarts, and the file
    // says outright what protection it has, so the degradation is never invisible.
    const vault = createSecretVault(file, null);
    vault.set('hq:session', TOKEN);

    expect(vault.protection).toBe('plaintext');
    expect(readDocument()).toEqual({
      v: 1,
      protection: 'plaintext',
      data: { 'hq:session': TOKEN },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('re-encrypts an unprotected store as soon as a keyring is available', () => {
    createSecretVault(file, null).set('hq:session', TOKEN);

    // Opening alone must migrate it: waiting for the next credential edit would leave the exposed
    // copy on disk indefinitely.
    const upgraded = createSecretVault(file, KEY);

    expect(upgraded.get('hq:session')).toBe(TOKEN);
    expect(readDocument().protection).toBe('os-keyring');
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
  });

  it('starts empty when the store is encrypted but the keyring is gone', () => {
    createSecretVault(file, KEY).set('hq:session', TOKEN);

    const vault = createSecretVault(file, null);

    expect(vault.get('hq:session')).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('reads a store left by an earlier unprotected run', () => {
    writeFileSync(
      file,
      JSON.stringify({ v: 1, protection: 'plaintext', data: { 'hq:session': TOKEN } }),
    );

    expect(createSecretVault(file, null).get('hq:session')).toBe(TOKEN);
  });
});

describe('secret vault store integrity', () => {
  it('starts empty on a corrupt store instead of throwing at boot', () => {
    writeFileSync(file, 'not json at all');

    expect(createSecretVault(file, KEY).get('hq:session')).toBeNull();
  });

  it('drops one malformed entry rather than losing the whole store', () => {
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        protection: 'plaintext',
        data: { 'hq:session': TOKEN, 'account:acc_1': { not: 'a secret' } },
      }),
    );

    const vault = createSecretVault(file, null);

    expect(vault.get('hq:session')).toBe(TOKEN);
    expect(vault.get('account:acc_1')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not create the file until something is stored', () => {
    createSecretVault(file, KEY);

    expect(existsSync(file)).toBe(false);
  });
});
