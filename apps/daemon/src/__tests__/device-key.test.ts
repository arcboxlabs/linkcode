import { Buffer } from 'node:buffer';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adoptLegacyDeviceKeyFile, ensureSoftwareDeviceKey } from '../cloud/device-key';
import { legacyDeviceKeyPath } from '../config';
import { logger } from '../logger';
import type { InMemoryVault } from './fixtures/in-memory-vault';
import { createInMemoryVault } from './fixtures/in-memory-vault';

// The module takes its vault as a parameter; the hardware path is skipped entirely — this is the
// software fallback under test.
let vault: InMemoryVault;
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-device-key-'));
  process.env.LINKCODE_CHANNEL = 'release';
  vault = createInMemoryVault();
  vi.spyOn(logger, 'warn').mockImplementation(noop);
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

/** A `device-key.pem` as every daemon before CODE-371 wrote it: bare PKCS#8, 0600 at best. */
function seedLegacyKeyFile(): { privatePem: string; publicKeyPem: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(join(process.env.HOME ?? '', '.linkcode'), { recursive: true });
  writeFileSync(legacyDeviceKeyPath(), privatePem);
  return {
    privatePem,
    publicKeyPem: createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }),
  };
}

describe('software device key', () => {
  it('mints a key the vault holds, and signs verifiably under the public key it reports', () => {
    const device = ensureSoftwareDeviceKey(vault);

    expect(vault.refs.get('device:software-key')).toContain('PRIVATE KEY');
    // Registration stakes the device's identity on this pairing: the signature it sends must verify
    // under the public key it sends alongside.
    const signature = Buffer.from(device.sign('proof-of-possession'), 'base64url');
    const publicKey = createPublicKey(device.publicKeyPem);
    expect(verify(null, Buffer.from('proof-of-possession'), publicKey, signature)).toBe(true);
  });

  it('reports software custody even when the keyring is protecting the key', () => {
    // A keyring-wrapped key is still extractable with the user's session; the server must not read
    // it as hardware-bound.
    expect(ensureSoftwareDeviceKey(vault).protection).toBe('software');
  });

  it('reuses the stored key instead of minting a new identity every boot', () => {
    const first = ensureSoftwareDeviceKey(vault);

    expect(ensureSoftwareDeviceKey(vault).publicKeyPem).toBe(first.publicKeyPem);
  });

  it('uses the stored key as-is, keeping the device id it was registered under', () => {
    const { privatePem, publicKeyPem } = seedLegacyKeyFile();
    vault.namespace('device').set('software-key', privatePem);

    // The device id is this key's fingerprint, so substituting a key would orphan the machine's cloud
    // registration and its tunnel host id.
    expect(ensureSoftwareDeviceKey(vault).publicKeyPem).toBe(publicKeyPem);
  });

  it('mints a fresh identity when the vault lost the key', () => {
    const first = ensureSoftwareDeviceKey(vault);
    vault = createInMemoryVault();

    // The defined reset: the same vault loss also drops the session token, so the daemon is signed
    // out and the next sign-in registers this new key rather than half-using the old identity.
    expect(ensureSoftwareDeviceKey(vault).publicKeyPem).not.toBe(first.publicKeyPem);
  });
});

// Runs at boot, independent of custody: the hosts that most need the sweep — signed out, or since
// moved to hardware custody — never reach the software fallback at all, and would otherwise keep a
// registered device's private key in the clear forever.
describe('legacy device-key.pem sweep', () => {
  it('takes the bare PEM into the vault and off disk', () => {
    const { privatePem } = seedLegacyKeyFile();

    adoptLegacyDeviceKeyFile(vault);

    expect(existsSync(legacyDeviceKeyPath())).toBe(false);
    expect(vault.refs.get('device:software-key')).toBe(privatePem);
  });

  it('keeps a key the vault already holds rather than reverting to the file', () => {
    seedLegacyKeyFile();
    vault.namespace('device').set('software-key', 'current-key-pem');

    adoptLegacyDeviceKeyFile(vault);

    expect(vault.refs.get('device:software-key')).toBe('current-key-pem');
    expect(existsSync(legacyDeviceKeyPath())).toBe(false);
  });

  it('does nothing when there is no legacy file', () => {
    adoptLegacyDeviceKeyFile(vault);

    expect(vault.refs.size).toBe(0);
  });
});
