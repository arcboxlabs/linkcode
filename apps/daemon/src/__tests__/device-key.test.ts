import { Buffer } from 'node:buffer';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stand in for the vault so these cases never reach the OS keyring; the vault's own custody rules
// are covered separately. The hardware path is skipped entirely — this is the fallback under test.
const vault = vi.hoisted(() => new Map<string, string>());

vi.mock('../secrets', () => ({
  DEVICE_SOFTWARE_KEY_REF: 'device:software-key',
  secretVault: () => ({
    protection: 'os-keyring',
    get: (ref: string) => vault.get(ref) ?? null,
    set(ref: string, secret: string) {
      vault.set(ref, secret);
    },
    delete(ref: string) {
      vault.delete(ref);
    },
  }),
}));

import { legacyDeviceKeyPath } from '../config';
import { ensureSoftwareDeviceKey } from '../hq/device-key';
import { logger } from '../logger';

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-device-key-'));
  process.env.LINKCODE_CHANNEL = 'release';
  vault.clear();
  vi.spyOn(logger, 'warn').mockImplementation(noop);
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

/** A `device-key.pem` as every daemon before CODE-371 wrote it: bare PKCS#8, 0600 at best. */
function seedLegacyKeyFile(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(join(process.env.HOME ?? '', '.linkcode'), { recursive: true });
  writeFileSync(legacyDeviceKeyPath(), pem);
  return createPublicKey(pem).export({ type: 'spki', format: 'pem' });
}

describe('software device key', () => {
  it('mints a key the vault holds, and signs verifiably under the public key it reports', () => {
    const device = ensureSoftwareDeviceKey();

    expect(vault.get('device:software-key')).toContain('PRIVATE KEY');
    // Registration stakes the device's identity on this pairing: the signature it sends must verify
    // under the public key it sends alongside.
    const signature = Buffer.from(device.sign('proof-of-possession'), 'base64url');
    const publicKey = createPublicKey(device.publicKeyPem);
    expect(verify(null, Buffer.from('proof-of-possession'), publicKey, signature)).toBe(true);
  });

  it('reports software custody even when the keyring is protecting the key', () => {
    // A keyring-wrapped key is still extractable with the user's session; the server must not read
    // it as hardware-bound.
    expect(ensureSoftwareDeviceKey().protection).toBe('software');
  });

  it('reuses the stored key instead of minting a new identity every boot', () => {
    const first = ensureSoftwareDeviceKey();

    expect(ensureSoftwareDeviceKey().publicKeyPem).toBe(first.publicKeyPem);
  });

  it('adopts a legacy PEM without changing the device id, and takes it off disk', () => {
    const publicKeyPem = seedLegacyKeyFile();

    const device = ensureSoftwareDeviceKey();

    // The device id is this key's fingerprint, so replacing the key would orphan the machine's HQ
    // registration and its tunnel host id. Migration has to keep the very same key.
    expect(device.publicKeyPem).toBe(publicKeyPem);
    expect(existsSync(legacyDeviceKeyPath())).toBe(false);
    expect(vault.get('device:software-key')).toContain('PRIVATE KEY');
  });

  it('mints a fresh identity when the vault lost the key', () => {
    const first = ensureSoftwareDeviceKey();
    vault.clear();

    // The defined reset: the same vault loss also drops the session token, so the daemon is signed
    // out and the next sign-in registers this new key rather than half-using the old identity.
    expect(ensureSoftwareDeviceKey().publicKeyPem).not.toBe(first.publicKeyPem);
  });
});
