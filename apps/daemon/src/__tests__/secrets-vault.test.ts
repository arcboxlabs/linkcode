import { Buffer } from 'node:buffer';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createFixedArray } from 'foxts/create-fixed-array';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import type { MasterKey } from '../secrets/keyring';
import type { SecretStore } from '../secrets/vault';
import { createSecretVault } from '../secrets/vault';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const TOKEN = 'sk-ant-super-secret';

/** A keyring that handed back a key it was already holding. */
const storedKey = (secret: Buffer) => (): MasterKey => ({ secret, fresh: false });
/** A keyring that had nothing, so this key was minted just now. */
const mintedKey = (secret: Buffer) => (): MasterKey => ({ secret, fresh: true });
const noKeyring = (): MasterKey | null => null;

/**
 * Secrets are only reachable through a namespace, so every case goes through one. On disk the same
 * entry is the full `cloud:session` ref — asserting against that is what proves the prefixing.
 */
function open(file: string, loadKey: () => MasterKey | null): SecretStore {
  return createSecretVault(file, loadKey).namespace('cloud');
}

let file: string;
const realPlatform = process.platform;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'linkcode-vault-')), 'secrets.json');
  vi.spyOn(logger, 'warn').mockImplementation(noop);
  vi.spyOn(logger, 'error').mockImplementation(noop);
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.restoreAllMocks();
});

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function readDocument(): { protection: string; data: unknown; keyringDistrusted?: boolean } {
  return JSON.parse(readFileSync(file, 'utf8')) as {
    protection: string;
    data: unknown;
    keyringDistrusted?: boolean;
  };
}

describe('secret vault under an OS keyring', () => {
  it('keeps the secret out of the file and reads it back through the master key', () => {
    open(file, storedKey(KEY)).set('session', TOKEN);

    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(readDocument().protection).toBe('os-keyring');
    expect(open(file, storedKey(KEY)).get('session')).toBe(TOKEN);
  });

  it('writes the store 0600 — the ciphertext is still a credential envelope', () => {
    open(file, storedKey(KEY)).set('session', TOKEN);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('starts empty when the master key no longer matches the ciphertext', () => {
    open(file, storedKey(KEY)).set('session', TOKEN);

    // A wiped keyring entry mints a fresh key; the old ciphertext is then unrecoverable, which is a
    // permanent loss to report and reset from, not a transient failure to retry.
    expect(open(file, storedKey(OTHER_KEY)).get('session')).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('forgets a deleted secret on disk, not just in memory', () => {
    const store = open(file, storedKey(KEY));
    store.set('session', TOKEN);
    store.delete('session');

    expect(open(file, storedKey(KEY)).get('session')).toBeNull();
  });
});

describe('secret vault namespaces', () => {
  it('scopes keys so two subsystems cannot collide on the same name', () => {
    const vault = createSecretVault(file, storedKey(KEY));
    vault.namespace('cloud').set('session', 'cloud-secret');
    vault.namespace('account').set('session', 'account-secret');

    expect(vault.namespace('cloud').get('session')).toBe('cloud-secret');
    expect(vault.namespace('account').get('session')).toBe('account-secret');
  });

  it('confines replaceAll to its own namespace', () => {
    const vault = createSecretVault(file, storedKey(KEY));
    vault.namespace('account').set('acc_1', 'first');
    vault.namespace('cloud').set('session', TOKEN);

    // Prune-on-save is only safe to hand out because it cannot reach a neighbour: this is the
    // property that replaced a hand-rolled prefix scan every consumer would have re-implemented.
    vault.namespace('account').replaceAll(new Map([['acc_2', 'second']]));

    expect(vault.namespace('account').get('acc_1')).toBeNull();
    expect(vault.namespace('account').get('acc_2')).toBe('second');
    expect(vault.namespace('cloud').get('session')).toBe(TOKEN);
  });

  it('takes a whole namespace in one call, however many entries it holds', () => {
    const vault = createSecretVault(file, storedKey(KEY));
    const entries = new Map(createFixedArray(20).map((index) => [`acc_${index}`, 'secret']));

    // The point of the single-call shape is that a save costs one re-encrypt of the store rather
    // than one per entry. That count is not cheaply observable without mocking `node:fs`, so what is
    // pinned here is the contract that makes it possible: the whole set lands atomically.
    vault.namespace('account').replaceAll(entries);

    expect(vault.namespace('account').get('acc_0')).toBe('secret');
    expect(vault.namespace('account').get('acc_19')).toBe('secret');
    expect(createSecretVault(file, storedKey(KEY)).namespace('account').get('acc_19')).toBe(
      'secret',
    );
  });
});

describe('secret vault without a keyring', () => {
  it('persists in the clear, and records on disk that it did', () => {
    // The chosen trade-off (CODE-371): a headless host stays usable across restarts, and the file
    // says outright what protection it has, so the degradation is never invisible.
    const vault = createSecretVault(file, noKeyring);
    vault.namespace('cloud').set('session', TOKEN);

    expect(vault.protection).toBe('plaintext');
    expect(readDocument()).toEqual({
      v: 1,
      protection: 'plaintext',
      data: { 'cloud:session': TOKEN },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('re-encrypts an unprotected store as soon as a keyring is available', () => {
    open(file, noKeyring).set('session', TOKEN);

    // Opening alone must migrate it: waiting for the next credential edit would leave the exposed
    // copy on disk indefinitely.
    expect(open(file, storedKey(KEY)).get('session')).toBe(TOKEN);
    expect(readDocument().protection).toBe('os-keyring');
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
  });

  it('starts empty when the store is encrypted but the keyring is gone', () => {
    open(file, storedKey(KEY)).set('session', TOKEN);

    expect(open(file, noKeyring).get('session')).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('reads a store left by an earlier unprotected run', () => {
    writeFileSync(
      file,
      JSON.stringify({ v: 1, protection: 'plaintext', data: { 'cloud:session': TOKEN } }),
    );

    expect(open(file, noKeyring).get('session')).toBe(TOKEN);
  });
});

// @napi-rs/keyring silently uses the kernel keyring (keyutils) on a Linux host with no D-Bus Secret
// Service, and those keys do not survive a reboot — so the store reads as encrypted while losing
// every credential on each restart. The binding cannot be asked which backend it picked, so the
// vault infers it from the one observable symptom: a freshly minted key beside existing ciphertext.
describe('secret vault against a non-durable keyring', () => {
  /** What a keyutils host looks like on the boot after it wrote ciphertext. */
  function seedOrphanedCiphertext(): void {
    setPlatform('linux');
    open(file, storedKey(KEY)).set('session', TOKEN);
  }

  it('stops trusting the keyring and records the verdict on disk', () => {
    seedOrphanedCiphertext();

    const vault = createSecretVault(file, mintedKey(OTHER_KEY));

    expect(vault.protection).toBe('plaintext');
    expect(readDocument().keyringDistrusted).toBe(true);
  });

  it('keeps the next boot out of the keyring entirely', () => {
    seedOrphanedCiphertext();
    createSecretVault(file, mintedKey(OTHER_KEY));

    // Sticky: a keyring proven not to retain the key must not be consulted again, or every boot
    // re-mints, re-orphans, and re-reports the same loss.
    const loadKey = vi.fn(mintedKey(KEY));
    const vault = createSecretVault(file, loadKey);

    expect(loadKey).not.toHaveBeenCalled();
    expect(vault.protection).toBe('plaintext');
  });

  it('does not re-encrypt the store it just demoted', () => {
    seedOrphanedCiphertext();
    createSecretVault(file, mintedKey(OTHER_KEY));

    open(file, storedKey(KEY)).set('session', TOKEN);

    // The upgrade path and the demotion would otherwise fight each other on alternating boots.
    expect(readDocument().protection).toBe('plaintext');
    expect(readDocument().keyringDistrusted).toBe(true);
    expect(open(file, noKeyring).get('session')).toBe(TOKEN);
  });

  it('leaves a first-run host alone — no ciphertext means nothing was lost', () => {
    setPlatform('linux');

    const vault = createSecretVault(file, mintedKey(KEY));
    vault.namespace('cloud').set('session', TOKEN);

    expect(vault.protection).toBe('os-keyring');
    expect(readDocument().keyringDistrusted).toBeUndefined();
  });

  it('does not demote macOS, where a missing entry means someone deleted it', () => {
    setPlatform('darwin');
    open(file, storedKey(KEY)).set('session', TOKEN);

    // Durable keyring: the honest reading is a deliberate deletion or a new profile, not a backend
    // that cannot hold a key — so keep encrypting.
    const vault = createSecretVault(file, mintedKey(OTHER_KEY));

    expect(vault.protection).toBe('os-keyring');
    expect(readDocument().keyringDistrusted).toBeUndefined();
  });
});

describe('secret vault store integrity', () => {
  it('starts empty on a corrupt store instead of throwing at boot', () => {
    writeFileSync(file, 'not json at all');

    expect(open(file, storedKey(KEY)).get('session')).toBeNull();
  });

  it('drops one malformed entry rather than losing the whole store', () => {
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        protection: 'plaintext',
        data: { 'cloud:session': TOKEN, 'cloud:other': { not: 'a secret' } },
      }),
    );

    const store = open(file, noKeyring);

    expect(store.get('session')).toBe(TOKEN);
    expect(store.get('other')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not create the file until something is stored', () => {
    createSecretVault(file, storedKey(KEY));

    expect(existsSync(file)).toBe(false);
  });
});
