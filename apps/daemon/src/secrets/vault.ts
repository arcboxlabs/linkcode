import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { logger } from '../logger';
import type { MasterKey } from './keyring';

/**
 * Where the daemon's long-lived secrets — cloud session token, provider/account credentials, the
 * software device key — actually live, keeping `config.json` / `cloud.json` to structure only.
 *
 * Custody is a master key in the OS keyring plus AES-256-GCM ciphertext in `secrets.json` — one
 * keyring round-trip per boot regardless of how many secrets there are, and losing the keyring entry
 * loses exactly the secrets, never the surrounding configuration. On a host with no usable keyring
 * the vault degrades to plaintext on disk (`0600`) rather than failing closed, which keeps headless
 * machines usable; `protection` reports which of the two is in force and the file records it, so the
 * degradation is never invisible.
 *
 * Callers never see a whole-store handle: {@link namespace} is the only way in, so no subsystem can
 * read or clear another's secrets.
 */
export interface SecretVault {
  /** Whether the OS is protecting `secrets.json`, or it is plaintext on disk. */
  readonly protection: SecretProtection;
  namespace: (name: SecretNamespace) => SecretStore;
}

/**
 * One subsystem's slice of the vault. Keys are scoped to the namespace, so
 * {@link SecretStore.replaceAll} can prune what the owner no longer has without any risk of reaching
 * a neighbour — the property that makes prune-on-save safe to hand out.
 */
export interface SecretStore {
  /** Whether the OS is protecting the store these secrets live in. */
  readonly protection: SecretProtection;
  get: (key: string) => string | null;
  set: (key: string, secret: string) => void;
  delete: (key: string) => void;
  /**
   * Replace this namespace's entire content in **one** write: keys absent from `entries` are dropped.
   * This is what a `save*` should call — it makes deletion implicit and costs a single re-encrypt no
   * matter how many entries there are.
   */
  replaceAll: (entries: ReadonlyMap<string, string>) => void;
}

/**
 * The registry of vault namespaces. A closed union rather than a free string so a typo cannot mint a
 * silently orphaned universe; the `:` delimiter is what actually makes cross-namespace pruning
 * impossible. Domain knowledge (which keys exist, what they mean) belongs to the owning module, not
 * here — this is only the list of who has a slice.
 */
export type SecretNamespace = 'cloud' | 'provider' | 'account' | 'device';

export type SecretProtection = 'os-keyring' | 'plaintext';

/** AES-GCM nonce length in bytes, per NIST SP 800-38D. */
const IV_BYTES = 12;
/** AES-GCM authentication tag length in bytes. */
const TAG_BYTES = 16;

interface VaultFile {
  protection: SecretProtection;
  /**
   * Set once this host's keyring has been observed failing to retain the master key — the signature
   * of a non-durable backend (see {@link isNonDurableKeyring}). Sticky, and it suppresses the
   * plaintext→encrypted upgrade, so the two do not fight each other every boot. Delete the file to
   * re-arm the keyring.
   */
  keyringDistrusted?: boolean;
  /** Base64 `iv || tag || ciphertext` under `os-keyring`; the bare ref→secret map under `plaintext`. */
  data: unknown;
}

/**
 * `loadKey` is consulted lazily: a store this host has already marked `keyringDistrusted` must not
 * even reach the keyring, both to skip a pointless round-trip and to keep the demotion observable.
 */
export function createSecretVault(file: string, loadKey: () => MasterKey | null): SecretVault {
  const stored = readFile(file);
  const master = stored?.keyringDistrusted === true ? null : loadKey();
  const key = master?.secret ?? null;

  // A fresh key beside ciphertext someone else's key wrote means the keyring did not keep what we
  // gave it. Demote before decoding, so the loss is reported as a backend verdict, not corruption.
  const distrusted = stored?.keyringDistrusted === true || isNonDurableKeyring(stored, master);
  const protection: SecretProtection = key === null || distrusted ? 'plaintext' : 'os-keyring';
  const secrets = decodeSecrets(stored, protection === 'os-keyring' ? key : null, file);

  if (protection === 'plaintext') {
    logger.warn(
      { operation: 'secrets.vault', file, keyringDistrusted: distrusted },
      'Daemon secrets are stored unencrypted; anyone who can read this file has the credentials',
    );
  }

  const persist = (): void => {
    mkdirSync(dirname(file), { recursive: true });
    const map = Object.fromEntries(secrets);
    const encrypted = protection === 'os-keyring' && key !== null;
    const document: VaultFile = {
      protection,
      data: encrypted ? encrypt(key, JSON.stringify(map)) : map,
      ...(distrusted && { keyringDistrusted: true }),
    };
    writeFileSync(file, `${JSON.stringify({ v: 1, ...document })}\n`, { mode: 0o600 });
  };

  // Either transition must land without waiting for a write from the caller: an upgrade (plaintext
  // file, keyring now present) leaves the exposed copy on disk until the next credential edit, and a
  // demotion leaves undecryptable ciphertext plus an unrecorded verdict.
  const needsRewrite =
    (protection === 'os-keyring' && stored?.protection === 'plaintext' && secrets.size > 0) ||
    (distrusted && stored?.keyringDistrusted !== true);
  if (needsRewrite) {
    logger.warn(
      { operation: 'secrets.vault', file, protection },
      distrusted
        ? "This host's OS keyring does not retain the master key; storing daemon secrets unencrypted from now on"
        : 'Re-encrypting daemon secrets that were stored unencrypted',
    );
    persist();
  }

  return {
    protection,
    namespace(name) {
      const prefix = `${name}:`;
      return {
        protection,
        get: (key) => secrets.get(prefix + key) ?? null,
        set(key, secret) {
          secrets.set(prefix + key, secret);
          persist();
        },
        delete(key) {
          if (!secrets.delete(prefix + key)) return;
          persist();
        },
        replaceAll(entries) {
          for (const ref of secrets.keys()) {
            if (ref.startsWith(prefix)) secrets.delete(ref);
          }
          for (const [key, secret] of entries) secrets.set(prefix + key, secret);
          persist();
        },
      };
    },
  };
}

/**
 * Whether this host's keyring has just been caught not retaining the master key: we wrote ciphertext
 * under a key, and the keyring has since handed back nothing, so a fresh one was minted.
 *
 * That is the signature of `@napi-rs/keyring`'s Linux fallback. With no D-Bus Secret Service it
 * silently uses the kernel keyring (keyutils) instead, whose keys do not survive a reboot — so the
 * store looks encrypted while actually losing every credential on each restart. The binding exposes
 * no way to ask which backend it chose (unlike Chromium's `getSelectedStorageBackend`), so the
 * behaviour is the only available signal.
 *
 * Linux-only on purpose. macOS and Windows keyrings are durable, so the same observation there means
 * the entry was deliberately deleted or the profile is new — not a reason to stop using the keyring.
 */
function isNonDurableKeyring(stored: VaultFile | null, master: MasterKey | null): boolean {
  if (process.platform !== 'linux') return false;
  if (master?.fresh !== true) return false;
  return stored?.protection === 'os-keyring' && stored.data !== undefined;
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
  const { protection, data, keyringDistrusted } = raw as Partial<VaultFile>;
  if (protection !== 'os-keyring' && protection !== 'plaintext') return null;
  return { protection, data, ...(keyringDistrusted === true && { keyringDistrusted: true }) };
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
  const entries = Object.entries(raw);
  for (let i = 0, len = entries.length; i < len; i++) {
    const [ref, value] = entries[i];
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
