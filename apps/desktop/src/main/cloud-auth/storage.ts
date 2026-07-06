import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import log from 'electron-log';

/**
 * Storage backing the better-auth electron client's session + cookie data. The plugin's
 * `Storage` contract is a synchronous key/value store; we persist it as a single JSON map in
 * `userData`, encrypting each value with the OS keychain (`safeStorage`).
 *
 * On platforms where `safeStorage` is unavailable (e.g. a Linux box with no keyring), values
 * fall back to a base64 `plain:` encoding so login still works — logged once so it is visible.
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

export function createSafeStorage(): Storage {
  const file = join(app.getPath('userData'), 'cloud-auth.json');

  return {
    getItem(name) {
      const map = readMap(file);
      if (!Object.hasOwn(map, name)) return null;
      try {
        return decode(map[name]);
      } catch (err) {
        log.warn('[cloud-auth] failed to decode stored session data:', err);
        return null;
      }
    },
    setItem(name, value) {
      const map = readMap(file);
      map[name] = encode(value);
      writeFileSync(file, JSON.stringify(map), { mode: 0o600 });
    },
  };
}
