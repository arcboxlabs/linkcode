import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { deviceKeyPath, deviceKeysDir } from '../config';

/**
 * The daemon's device key — the machine's identity. Registered once with the
 * cloud, it keeps the device id (and therefore the tunnel host id) stable
 * across re-logins and account switches; signing with it is how the daemon
 * proves it is that machine (registration `keyProof`, tunnel handshake).
 *
 * Custody ladder: `@arcboxlabs/deviceid` holds a P-256 key in the platform's
 * security hardware (Secure Enclave / TPM) where available. When its native
 * module can't load or has no usable backend, a software Ed25519 keypair at
 * `~/.linkcode/device-key.pem` (0600) takes over — same interface, honestly
 * reported via `protection`. The server verifies both algorithms.
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
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  return {
    publicKeyPem,
    protection: 'software',
    sign: (payload) => sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  };
}
