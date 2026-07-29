import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { keyringServiceName } from '@linkcode/schema';
import { logger } from '../logger';
import { daemonChannel, daemonProfile } from '../paths';

/** Account name of the vault's master key within the universe's keyring service. */
const MASTER_KEY_ACCOUNT = 'secret-vault-key';

/** AES-256 key length. */
const MASTER_KEY_BYTES = 32;

const require = createRequire(import.meta.url);

/**
 * The master key protecting `secrets.json`, or `null` when this host has no usable OS keyring.
 *
 * Loading the native module is kept separate from calling it, because the two failures mean
 * different things and only one is our defect — the same split `device-key.ts` makes.
 */
export function loadMasterKey(): Buffer | null {
  const keyring = loadKeyring();
  if (keyring === null) return null;

  const service = keyringServiceName(daemonChannel(), daemonProfile());
  try {
    const entry = new keyring.Entry(service, MASTER_KEY_ACCOUNT);
    const existing = entry.getPassword();
    // `null` is a definitive "no such entry" — a backend failure throws instead, so generating
    // here cannot overwrite a key the keyring merely failed to hand us.
    if (existing !== null) return decodeMasterKey(existing);
    const created = randomBytes(MASTER_KEY_BYTES);
    entry.setPassword(created.toString('base64'));
    logger.info({ operation: 'secrets.keyring', service }, 'Created the OS-keyring master key');
    return created;
  } catch (err) {
    logger.warn(
      { operation: 'secrets.keyring', err, service, platform: process.platform },
      'No usable OS keyring on this host; daemon secrets fall back to plaintext on disk',
    );
    return null;
  }
}

/** A key of the wrong length cannot decrypt anything; treat it as absent and mint a fresh one. */
function decodeMasterKey(encoded: string): Buffer | null {
  const key = Buffer.from(encoded, 'base64');
  if (key.byteLength === MASTER_KEY_BYTES) return key;
  logger.error(
    { operation: 'secrets.keyring', length: key.byteLength },
    'Malformed OS-keyring master key; stored secrets are unrecoverable',
  );
  return null;
}

/**
 * `@napi-rs/keyring` resolves a per-platform prebuilt through npm optional dependencies, so a
 * require failure means this build carries no binding for the arch it runs on — a packaging defect,
 * not a property of the host.
 */
function loadKeyring(): typeof import('@napi-rs/keyring') | null {
  try {
    return require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  } catch (err) {
    logger.error(
      { operation: 'secrets.keyring', err, platform: process.platform, arch: process.arch },
      'No keyring native binding for this platform/arch; daemon secrets fall back to plaintext on disk. This is a packaging defect, not a property of this machine.',
    );
    return null;
  }
}
