import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import process from 'node:process';
import { deviceKeyPath, deviceKeysDir } from '../config';
import { logger } from '../logger';

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

/**
 * Load the native module, separately from calling it — the two failures mean different things and
 * only one is a defect. `@arcboxlabs/deviceid` resolves a per-platform prebuilt through npm
 * optional dependencies, so a require failure means this build carries no binding for the arch it
 * is running on (a packaging bug: the app was packed for an arch the build host did not install).
 */
function loadDeviceId(): typeof import('@arcboxlabs/deviceid') | null {
  try {
    return require('@arcboxlabs/deviceid') as typeof import('@arcboxlabs/deviceid');
  } catch (err) {
    logger.error(
      { operation: 'device-key.load', err, platform: process.platform, arch: process.arch },
      'No device-key native binding for this platform/arch; falling back to a software key. This is a packaging defect, not a property of this machine.',
    );
    return null;
  }
}

export function ensureDeviceKey(): DeviceKey {
  const module = loadDeviceId();
  if (module === null) return ensureSoftwareDeviceKey();
  try {
    // Fail-closed by design: throws on machines with no usable backend (no TPM, no Secret
    // Service). That is a legitimate property of the host, not an error to escalate.
    const device = module.ensureDeviceId({ dir: deviceKeysDir() });
    return {
      publicKeyPem: device.publicKeyPem,
      protection: device.protection === 'hardware' ? 'hardware' : 'software',
      sign: (payload) => device.sign(payload),
    };
  } catch (err) {
    logger.warn(
      { operation: 'device-key.ensure', err },
      'No hardware key store on this machine; using a software device key',
    );
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
