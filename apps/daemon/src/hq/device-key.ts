import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deviceKeyPath } from '../config';

/**
 * The daemon's device key: an Ed25519 keypair generated on first login and
 * kept at `~/.linkcode/device-key.pem` (0600). Its public half is registered
 * with the device; signing HQ's challenge with it is how a fresh session
 * proves it runs on the same machine and keeps the device id (and therefore
 * the tunnel host id) across re-logins.
 */
export interface DeviceKey {
  /** SPKI PEM, sent on device registration. */
  publicKeyPem: string;
  /** Raw Ed25519 signature over the UTF-8 payload, base64url. */
  sign: (payload: string) => string;
}

export function ensureDeviceKey(): DeviceKey {
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
    sign: (payload) => sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  };
}
