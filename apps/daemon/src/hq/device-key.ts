import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { deviceKeysDir, legacyDeviceKeyPath } from '../config';
import { logger } from '../logger';
import { DEVICE_SOFTWARE_KEY_REF, secretVault } from '../secrets';

/**
 * The device key is the machine's identity: it keeps the device id (= tunnel host id) stable
 * across re-logins and account switches, and signing with it proves possession (registration
 * `keyProof`, tunnel handshake). Custody: hardware P-256 via `@arcboxlabs/deviceid` where
 * available, else a software Ed25519 keypair in the secret vault (CODE-371) — OS-protected wherever
 * a keyring exists, which notably includes the hosts that reach the fallback *because* they have no
 * TPM. `protection` reports `software` for it either way: the server must not treat a
 * keyring-wrapped key as hardware-bound.
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

/** The fallback custody path, reachable on its own: no hardware backend, key held by the vault. */
export function ensureSoftwareDeviceKey(): DeviceKey {
  const privatePem = loadSoftwarePrivateKey() ?? createSoftwarePrivateKey();
  const privateKey = createPrivateKey(privatePem);
  const publicKeyPem = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
  return {
    publicKeyPem,
    protection: 'software',
    sign: (payload) => sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  };
}

/**
 * The stored software key, or `null` when this machine has none yet. A key left as a bare PEM by an
 * older daemon is adopted rather than replaced: the device id is the fingerprint of this key, so
 * regenerating would silently orphan the HQ registration and the tunnel host id with it.
 */
function loadSoftwarePrivateKey(): string | null {
  const stored = secretVault().get(DEVICE_SOFTWARE_KEY_REF);
  if (stored !== null) return stored;

  const path = legacyDeviceKeyPath();
  let legacyPem: string;
  try {
    legacyPem = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  logger.warn(
    { operation: 'device-key.migrate' },
    'Moving the software device key off disk into the secret vault',
  );
  secretVault().set(DEVICE_SOFTWARE_KEY_REF, legacyPem);
  rmSync(path, { force: true });
  return legacyPem;
}

/**
 * Mint a fresh software key. Reached on a new machine, and on one whose keyring lost the vault's
 * master key — in which case the device id changes and HQ sees a new device. That is the defined
 * reset: the same vault loss also takes the session token, so the daemon is already signed out and
 * the next sign-in registers this key. Nothing is silently left half-valid.
 */
function createSoftwarePrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  secretVault().set(DEVICE_SOFTWARE_KEY_REF, privatePem);
  logger.warn(
    { operation: 'device-key.create', protection: secretVault().protection },
    'Generated a new software device key; this machine registers with HQ under a new device id',
  );
  return privatePem;
}
