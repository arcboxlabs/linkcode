import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  encryptionAvailable: true,
  // Stands in for the OS keychain's per-app-identity key: ciphertext written under one
  // key value fails to decrypt under another, like a foreign safeStorage identity.
  keychainKey: 'A',
  warn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    encryptString: (json: string) => Buffer.from(`${mocks.keychainKey}:${json}`, 'utf8'),
    decryptString(buf: Buffer) {
      const text = buf.toString('utf8');
      if (!text.startsWith(`${mocks.keychainKey}:`)) {
        throw new Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
        );
      }
      return text.slice(mocks.keychainKey.length + 1);
    },
  },
}));

vi.mock('electron-log', () => ({ default: { warn: mocks.warn } }));

let root: string;

function storeFile(): string {
  return join(mocks.userData, 'cloud-auth.json');
}

beforeEach(() => {
  vi.resetModules();
  mocks.warn.mockReset();
  mocks.encryptionAvailable = true;
  mocks.keychainKey = 'A';
  root = mkdtempSync(join(tmpdir(), 'linkcode-cloud-auth-'));
  mocks.userData = join(root, 'user-data');
  mkdirSync(mocks.userData, { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

async function createStorage() {
  const { createSafeStorage } = await import('../cloud-auth/storage');
  return createSafeStorage();
}

describe('cloud-auth safe storage', () => {
  it('resolves the store path at call time, not at construction', async () => {
    // Regression: the storage is constructed at module scope, before main re-points
    // userData to the app identity's directory. An eagerly captured path leaks the
    // store into the productName-derived profile.
    const wrongDir = mocks.userData;
    const storage = await createStorage();

    mocks.userData = join(root, 'identity-user-data');
    mkdirSync(mocks.userData, { recursive: true });

    storage.setItem('session', { token: 't' });

    expect(existsSync(storeFile())).toBe(true);
    expect(existsSync(join(wrongDir, 'cloud-auth.json'))).toBe(false);
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('discards an undecryptable entry and keeps the rest', async () => {
    const storage = await createStorage();
    storage.setItem('good', 'kept');
    mocks.keychainKey = 'B';
    storage.setItem('foreign', 'poison');
    mocks.keychainKey = 'A';

    expect(storage.getItem('foreign')).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(readFileSync(storeFile(), 'utf8')))).toEqual(['good']);

    // The pruned entry is gone from the store, so later reads stay silent.
    expect(storage.getItem('foreign')).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(storage.getItem('good')).toBe('kept');
  });

  it('round-trips through the plain fallback when the keychain is unavailable', async () => {
    mocks.encryptionAvailable = false;
    const storage = await createStorage();
    storage.setItem('session', { token: 't' });

    expect(readFileSync(storeFile(), 'utf8')).toContain('plain:');
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });
});
