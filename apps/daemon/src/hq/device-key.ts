import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { deviceKeyPath, deviceKeysDir } from '../config';

/**
 * The device key is the machine's identity: it keeps the device id (= tunnel host id) stable
 * across re-logins and account switches, and signing with it proves possession (registration
 * `keyProof`, tunnel handshake). Custody: hardware P-256 via `@arcboxlabs/deviceid` where
 * available, else a software Ed25519 keypair at `~/.linkcode/device-key.pem` (0600), honestly
 * reported via `protection`; the server verifies both algorithms.
 */
export interface DeviceKey {
  /** SPKI PEM, sent on device registration. */
  publicKeyPem: string;
  /** Where the private key lives; reported on registration, never trusted. */
  protection: 'hardware' | 'software';
  /** Signature over the UTF-8 payload, base64url (Ed25519 raw or P-256 P1363). */
  sign: (payload: string) => string;
}

const require = createRequire(import.meta.url);

export function ensureDeviceKey(): DeviceKey {
  try {
    // Native module: resolves per-platform prebuilt binaries; throws where
    // none fits (unsupported platform, missing keyring) — hence the fallback.
    const { ensureDeviceId } =
      require('@arcboxlabs/deviceid') as typeof import('@arcboxlabs/deviceid');
    const device = ensureDeviceId({ dir: deviceKeysDir() });
    return {
      publicKeyPem: device.publicKeyPem,
      protection: device.protection === 'hardware' ? 'hardware' : 'software',
      sign: (payload) => device.sign(payload),
    };
  } catch {
    return ensureSoftwareDeviceKey();
  }
}

function ensureSoftwareDeviceKey(): DeviceKey {
  const path = deviceKeyPath();
  let privatePem: string;
  try {
    privatePem = readFileSync(path, 'utf8');
  } catch {
    const { privateKey } = generateKeyPairSync('ed25519');
    privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, privatePem, { mode: 0o600 });
  }
  const privateKey = createPrivateKey(privatePem);
  const publicKeyPem = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
  return {
    publicKeyPem,
    protection: 'software',
    sign: (payload) => sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  };
}
