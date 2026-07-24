import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  encryptionAvailable: true,
  storageBackend: 'gnome_libsecret',
  // Stands in for the OS keychain's per-app-identity key: ciphertext written under one
  // key value fails to decrypt under another, like a foreign safeStorage identity.
  keychainKey: 'A',
  warn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    getSelectedStorageBackend: () => mocks.storageBackend,
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
const realPlatform = process.platform;

function storeFile(): string {
  return join(mocks.userData, 'cloud-auth.json');
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** An entry as the pre-CODE-371 base64 fallback wrote it. */
function seedLegacyPlain(name: string, value: unknown): void {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  writeFileSync(storeFile(), JSON.stringify({ [name]: `plain:${encoded}` }));
}

beforeEach(() => {
  vi.resetModules();
  mocks.warn.mockReset();
  mocks.encryptionAvailable = true;
  mocks.storageBackend = 'gnome_libsecret';
  mocks.keychainKey = 'A';
  root = mkdtempSync(join(tmpdir(), 'linkcode-cloud-auth-'));
  mocks.userData = join(root, 'user-data');
  mkdirSync(mocks.userData, { recursive: true });
});

afterEach(() => {
  setPlatform(realPlatform);
  rmSync(root, { force: true, recursive: true });
});

async function createStorage() {
  const { createSafeStorage } = await import('../cloud-auth/storage');
  return createSafeStorage();
}

describe('cloud-auth safe storage', () => {
  it('resolves the store path at call time, not at construction', async () => {
    // Regression: the storage is constructed at module scope, before main re-points userData —
    // an eagerly captured path leaks the store into the productName-derived profile.
    const wrongDir = mocks.userData;
    const storage = await createStorage();

    mocks.userData = join(root, 'identity-user-data');
    mkdirSync(mocks.userData, { recursive: true });

    storage.setItem('session', { token: 't' });

    expect(existsSync(storeFile())).toBe(true);
    expect(existsSync(join(wrongDir, 'cloud-auth.json'))).toBe(false);
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('keeps an undecryptable entry on disk and warns once', async () => {
    const storage = await createStorage();
    storage.setItem('good', 'kept');
    mocks.keychainKey = 'B';
    storage.setItem('stuck', 'recoverable');
    mocks.keychainKey = 'A';

    expect(storage.getItem('stuck')).toBeNull();
    expect(storage.getItem('stuck')).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(storage.getItem('good')).toBe('kept');

    // The entry survives on disk, so a transient keychain failure (e.g. a declined ACL
    // prompt) does not destroy the session: once decryption works again, the value is back.
    expect(Object.keys(JSON.parse(readFileSync(storeFile(), 'utf8'))).sort()).toEqual([
      'good',
      'stuck',
    ]);
    mocks.keychainKey = 'B';
    expect(storage.getItem('stuck')).toBe('recoverable');
  });

  it('never touches disk when the keychain is unavailable', async () => {
    mocks.encryptionAvailable = false;
    const storage = await createStorage();
    storage.setItem('session', { token: 't' });

    // The whole point of CODE-371: a long-lived token must not land in a file the OS is not
    // guarding. It stays usable for this run, and dies with the process.
    expect(existsSync(storeFile())).toBe(false);
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('treats the linux basic_text backend as no keychain at all', async () => {
    // isEncryptionAvailable() reports true there while Chromium derives the key from a hardcoded
    // in-memory password — ciphertext under a published key is not protection.
    setPlatform('linux');
    mocks.encryptionAvailable = true;
    mocks.storageBackend = 'basic_text';
    const storage = await createStorage();
    storage.setItem('session', { token: 't' });

    expect(existsSync(storeFile())).toBe(false);
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('persists on linux once a real secret-service backend is selected', async () => {
    setPlatform('linux');
    mocks.storageBackend = 'kwallet6';
    const storage = await createStorage();
    storage.setItem('session', { token: 't' });

    expect(existsSync(storeFile())).toBe(true);
    expect(readFileSync(storeFile(), 'utf8')).not.toContain('plain:');
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('re-encrypts a legacy plaintext entry when the keychain can protect it', async () => {
    seedLegacyPlain('session', { token: 't' });
    const storage = await createStorage();

    expect(storage.getItem('session')).toEqual({ token: 't' });

    const onDisk = JSON.parse(readFileSync(storeFile(), 'utf8')) as Record<string, string>;
    expect(onDisk.session.startsWith('plain:')).toBe(false);
    // Readable again through the keychain path alone, proving the migration wrote real ciphertext.
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });

  it('drops a legacy plaintext entry from disk when the keychain cannot protect it', async () => {
    seedLegacyPlain('session', { token: 't' });
    mocks.encryptionAvailable = false;
    const storage = await createStorage();

    // Still usable for this run, so the upgrade does not silently sign the user out mid-session.
    expect(storage.getItem('session')).toEqual({ token: 't' });
    expect(JSON.parse(readFileSync(storeFile(), 'utf8'))).toEqual({});
    expect(storage.getItem('session')).toEqual({ token: 't' });
  });
});
