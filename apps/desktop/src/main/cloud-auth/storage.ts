import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { app, safeStorage } from 'electron';
import log from 'electron-log';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * Storage backing the better-auth electron client's session + cookie data: the plugin's `Storage`
 * contract is a synchronous key/value store, persisted as one JSON map in `userData` with each
 * value encrypted via the OS keychain (`safeStorage`).
 *
 * It fails closed. Where the OS cannot actually protect a value the session is held in memory for
 * this run instead of written to disk, so a long-lived token never lands in a file the OS is not
 * guarding. The cost is explicit: sign-in does not survive a restart on such a host.
 */
export interface Storage {
  getItem: (name: string) => unknown | null;
  setItem: (name: string, value: unknown) => void;
}

/** Marker of the pre-CODE-371 base64 fallback. Read to migrate the value off disk, never written. */
const LEGACY_PLAIN_PREFIX = 'plain:';

/** Values we refused to persist, keyed as on disk. Lost on quit — that is the point. */
const memory = new Map<string, unknown>();

/**
 * Whether the OS itself protects the ciphertext.
 *
 * `isEncryptionAvailable()` alone is not that question on Linux: with no libsecret/kwallet backend
 * it still reports true while Chromium derives the key from a hardcoded in-memory password, so the
 * ciphertext is obfuscation under a published key — exactly what must not be persisted. `unknown`
 * means the app is not ready yet; fail closed and re-check on the next call.
 */
function isOsBacked(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown';
}

// Resolved per call: this module loads before main sets the userData path, so an eager join would
// pin the store to the productName-derived dir and leak dev-shell data into the release profile.
function storageFile(): string {
  return join(app.getPath('userData'), 'cloud-auth.json');
}

function readMap(file: string): Map<string, string> {
  try {
    return new Map(
      Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>),
    );
  } catch {
    // Absent or unreadable store: start from empty. A corrupt file self-heals on next write.
    return new Map();
  }
}

function writeMap(file: string, map: Map<string, string>): void {
  writeFileSync(file, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 });
}

// A decode failure is indistinguishable from a transient keychain failure, so the entry must
// survive for the next attempt; deduping keeps a permanent failure from logging on every refresh.
const warnedKeys = new Set<string>();
let warnedUnprotected = false;

function warnUnprotectedOnce(): void {
  if (warnedUnprotected) return;
  warnedUnprotected = true;
  log.warn(
    '[cloud-auth] no OS-backed keychain on this host; the session is kept in memory and will not survive a restart',
  );
}

/**
 * Take a value written by the old base64 fallback off disk. It is already exposed, so the useful
 * move is to stop persisting it: re-encrypt where the keychain can now protect it, else carry it
 * in memory for this run. Either way the plaintext does not survive the read.
 */
function migrateLegacyPlain(
  file: string,
  map: Map<string, string>,
  name: string,
  stored: string,
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(stored.slice(LEGACY_PLAIN_PREFIX.length), 'base64').toString('utf8'),
    );
  } catch {
    map.delete(name);
    writeMap(file, map);
    return null;
  }
  if (isOsBacked()) {
    map.set(name, safeStorage.encryptString(JSON.stringify(value)).toString('base64'));
    log.warn(`[cloud-auth] re-encrypted the unprotected stored value for "${name}"`);
  } else {
    map.delete(name);
    memory.set(name, value);
    warnUnprotectedOnce();
    log.warn(`[cloud-auth] dropped the unprotected stored value for "${name}" from disk`);
  }
  writeMap(file, map);
  return value;
}

export function createSafeStorage(): Storage {
  return {
    getItem(name) {
      if (memory.has(name)) return memory.get(name) ?? null;

      const file = storageFile();
      const map = readMap(file);
      const stored = map.get(name);
      if (stored === undefined) return null;
      if (stored.startsWith(LEGACY_PLAIN_PREFIX)) {
        return migrateLegacyPlain(file, map, name, stored);
      }

      try {
        const value: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(stored, 'base64')));
        warnedKeys.delete(name);
        return value;
      } catch (err) {
        if (!warnedKeys.has(name)) {
          warnedKeys.add(name);
          log.warn(
            `[cloud-auth] failed to decode stored session data for "${name}": ${extractErrorMessage(err)}`,
          );
        }
        return null;
      }
    },
    setItem(name, value) {
      // Fail closed: hold the value for this run rather than write a token the OS will not guard.
      // The file is left untouched, so entries an intact keychain still owns are not destroyed.
      if (!isOsBacked()) {
        memory.set(name, value);
        warnUnprotectedOnce();
        return;
      }
      memory.delete(name);
      const file = storageFile();
      const map = readMap(file);
      map.set(name, safeStorage.encryptString(JSON.stringify(value)).toString('base64'));
      writeMap(file, map);
    },
  };
}
