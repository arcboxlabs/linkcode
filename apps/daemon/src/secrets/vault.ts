import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger';

/**
 * Where the daemon's long-lived secrets — HQ session token, provider/account credentials, the
 * software device key — actually live. They are kept out of `config.json` / `hq.json` entirely and
 * addressed by a stable ref (`account:<id>`, `hq:session`, …), so those files hold structure only.
 *
 * Custody is a master key in the OS keyring plus AES-256-GCM ciphertext in `secrets.json` — one
 * keyring round-trip per boot regardless of how many secrets there are, and losing the keyring entry
 * loses exactly the secrets, never the surrounding configuration. On a host with no usable keyring
 * the vault degrades to plaintext on disk (`0600`) rather than failing closed, which keeps headless
 * machines usable; `protection` reports which of the two is in force and the file records it, so the
 * degradation is never invisible.
 */
export interface SecretVault {
  /** Whether the OS is protecting `secrets.json`, or it is plaintext on disk. */
  readonly protection: SecretProtection;
  get: (ref: string) => string | null;
  set: (ref: string, secret: string) => void;
  delete: (ref: string) => void;
  /** Stored refs under `prefix` — what a caller prunes against when its owning records are rewritten. */
  list: (prefix: string) => string[];
}

export type SecretProtection = 'os-keyring' | 'plaintext';

/** AES-GCM nonce length in bytes, per NIST SP 800-38D. */
const IV_BYTES = 12;
/** AES-GCM authentication tag length in bytes. */
const TAG_BYTES = 16;

interface VaultFile {
  protection: SecretProtection;
  /** Base64 `iv || tag || ciphertext` under `os-keyring`; the bare ref→secret map under `plaintext`. */
  data: unknown;
}

/** `key` is the OS-keyring master key, or `null` on a host with no usable keyring. */
export function createSecretVault(file: string, key: Buffer | null): SecretVault {
  const protection: SecretProtection = key === null ? 'plaintext' : 'os-keyring';
  const stored = readFile(file);
  const secrets = decodeSecrets(stored, key, file);

  if (protection === 'plaintext') {
    logger.warn(
      { operation: 'secrets.vault', file },
      'Daemon secrets are stored unencrypted; anyone who can read this file has the credentials',
    );
  }

  const persist = (): void => {
    mkdirSync(dirname(file), { recursive: true });
    const map = Object.fromEntries(secrets);
    const data = key === null ? map : encrypt(key, JSON.stringify(map));
    writeFileSync(file, `${JSON.stringify({ v: 1, protection, data })}\n`, { mode: 0o600 });
  };

  // An upgrade (plaintext file, keyring now present) must land without waiting for a write from the
  // caller, or the exposed copy lingers on disk until the next credential edit.
  if (protection === 'os-keyring' && stored?.protection === 'plaintext' && secrets.size > 0) {
    logger.warn(
      { operation: 'secrets.vault', file },
      'Re-encrypting daemon secrets that were stored unencrypted',
    );
    persist();
  }

  return {
    protection,
    get: (ref) => secrets.get(ref) ?? null,
    set(ref, secret) {
      secrets.set(ref, secret);
      persist();
    },
    delete(ref) {
      if (!secrets.delete(ref)) return;
      persist();
    },
    list: (prefix) => [...secrets.keys()].filter((ref) => ref.startsWith(prefix)),
  };
}

/**
 * Decode the stored secrets, reconciling the file's recorded protection with what this host can
 * actually do. Ciphertext we cannot decrypt is a permanent loss, not a transient one: the master key
 * is either the one that wrote it or it is gone. Start empty and say so — callers then re-derive
 * (re-login, regenerate the device key) instead of failing in ways that read as corruption.
 */
function decodeSecrets(
  stored: VaultFile | null,
  key: Buffer | null,
  file: string,
): Map<string, string> {
  if (stored === null) return new Map();
  if (stored.protection === 'plaintext') return parseEntries(stored.data, file);
  if (key === null) {
    logger.error(
      { operation: 'secrets.vault', file },
      'Stored daemon secrets are encrypted but this host has no keyring to unlock them; starting empty',
    );
    return new Map();
  }
  if (typeof stored.data !== 'string') {
    logger.error(
      { operation: 'secrets.vault', file },
      'Malformed daemon secret store; starting empty',
    );
    return new Map();
  }
  try {
    return parseEntries(JSON.parse(decrypt(key, stored.data)), file);
  } catch (err) {
    logger.error(
      { operation: 'secrets.vault', err, file },
      'Could not decrypt the daemon secret store; the OS keyring master key no longer matches it. Starting empty — stored credentials must be re-entered.',
    );
    return new Map();
  }
}

function readFile(file: string): VaultFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // Absent or unreadable store: no secrets yet. A corrupt file self-heals on the next write.
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { protection, data } = raw as Partial<VaultFile>;
  if (protection !== 'os-keyring' && protection !== 'plaintext') return null;
  return { protection, data };
}

/** Drop anything that is not a string secret rather than failing the whole store over one entry. */
function parseEntries(raw: unknown, file: string): Map<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    logger.error(
      { operation: 'secrets.vault', file },
      'Malformed daemon secret store; starting empty',
    );
    return new Map();
  }
  const secrets = new Map<string, string>();
  for (const [ref, value] of Object.entries(raw)) {
    if (typeof value === 'string') secrets.set(ref, value);
    else logger.warn({ operation: 'secrets.vault', ref }, 'Dropping a malformed stored secret');
  }
  return secrets;
}

function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function decrypt(key: Buffer, encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
