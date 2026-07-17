import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import log from 'electron-log';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * Storage backing the better-auth electron client's session + cookie data: the plugin's `Storage`
 * contract is a synchronous key/value store, persisted as one JSON map in `userData` with each
 * value encrypted via the OS keychain (`safeStorage`). Where `safeStorage` is unavailable, values
 * fall back to a base64 `plain:` encoding so login still works (logged once).
 */
export interface Storage {
  getItem: (name: string) => unknown | null;
  setItem: (name: string, value: unknown) => void;
}

const PLAIN_PREFIX = 'plain:';

function readMap(file: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    // Absent or unreadable store: start from empty. A corrupt file self-heals on next write.
    return {};
  }
}

function writeMap(file: string, map: Record<string, string>): void {
  writeFileSync(file, JSON.stringify(map), { mode: 0o600 });
}

function encode(value: unknown): string {
  const json = JSON.stringify(value);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(json).toString('base64');
  }
  log.warn('[cloud-auth] OS keychain unavailable; persisting session data unencrypted');
  return PLAIN_PREFIX + Buffer.from(json, 'utf8').toString('base64');
}

function decode(stored: string): unknown {
  const json = stored.startsWith(PLAIN_PREFIX)
    ? Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
    : safeStorage.decryptString(Buffer.from(stored, 'base64'));
  return JSON.parse(json);
}

// Resolved per call: this module loads before main sets the userData path, so an eager join would
// pin the store to the productName-derived dir and leak dev-shell data into the release profile.
function storageFile(): string {
  return join(app.getPath('userData'), 'cloud-auth.json');
}

// A decode failure is indistinguishable from a transient keychain failure, so the entry must
// survive for the next attempt; deduping keeps a permanent failure from logging on every refresh.
const warnedKeys = new Set<string>();

export function createSafeStorage(): Storage {
  return {
    getItem(name) {
      const map = readMap(storageFile());
      if (!Object.hasOwn(map, name)) return null;
      try {
        const value = decode(map[name]);
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
      const file = storageFile();
      const map = readMap(file);
      map[name] = encode(value);
      writeMap(file, map);
    },
  };
}
