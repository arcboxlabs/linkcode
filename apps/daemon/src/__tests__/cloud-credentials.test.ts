import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real vault reaches the OS keyring; these cases are about what `cloud.json` keeps versus what
// it hands to the vault, so stand in an in-memory one. Vault behaviour itself is covered separately.
const vault = vi.hoisted(() => new Map<string, string>());

vi.mock('../secrets', () => ({
  CLOUD_SESSION_REF: 'cloud:session',
  secretVault: () => ({
    protection: 'os-keyring',
    get: (ref: string) => vault.get(ref) ?? null,
    set(ref: string, secret: string) {
      vault.set(ref, secret);
    },
    delete(ref: string) {
      vault.delete(ref);
    },
  }),
}));

import {
  clearCloudCredentials,
  loadCloudCredentials,
  saveCloudCredentials,
} from '../cloud/credentials';
import { cloudCredentialsPath, legacyHqCredentialsPath } from '../config';
import { logger } from '../logger';

const TOKEN = 'eyJhbGciOi-session-token';
const CREDENTIALS = { baseUrl: 'https://api.linkcode.ai', sessionToken: TOKEN, deviceId: 'dev_1' };

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-hq-'));
  process.env.LINKCODE_CHANNEL = 'release';
  vault.clear();
  vi.spyOn(logger, 'warn').mockImplementation(noop);
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

function readFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(cloudCredentialsPath(), 'utf8')) as Record<string, unknown>;
}

/** Sign-in state as every daemon before CODE-371 wrote it: token inline, in the clear. */
function seedInlineToken(path: string): void {
  mkdirSync(join(process.env.HOME ?? '', '.linkcode'), { recursive: true });
  writeFileSync(path, JSON.stringify(CREDENTIALS));
}

describe('cloud credentials', () => {
  it('keeps the session token out of cloud.json and reads it back from the vault', () => {
    saveCloudCredentials(CREDENTIALS);

    expect(readFile()).toEqual({ baseUrl: CREDENTIALS.baseUrl, deviceId: 'dev_1' });
    expect(readFileSync(cloudCredentialsPath(), 'utf8')).not.toContain(TOKEN);
    expect(loadCloudCredentials()).toEqual(CREDENTIALS);
  });

  it('migrates a token left inline by an older daemon, off disk on the same read', () => {
    seedInlineToken(cloudCredentialsPath());

    // The migration must not sign the user out: the very read that notices the exposed token still
    // returns it, so an in-flight uplink survives the upgrade.
    expect(loadCloudCredentials()).toEqual(CREDENTIALS);
    expect(readFile()).toEqual({ baseUrl: CREDENTIALS.baseUrl, deviceId: 'dev_1' });
    expect(vault.get('cloud:session')).toBe(TOKEN);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('adopts a pre-rename hq.json and retires it', () => {
    seedInlineToken(legacyHqCredentialsPath());

    // Both migrations at once: the file moves to cloud.json and the token moves to the vault, with
    // the old file gone so nothing can resurrect it.
    expect(loadCloudCredentials()).toEqual(CREDENTIALS);
    expect(readFile()).toEqual({ baseUrl: CREDENTIALS.baseUrl, deviceId: 'dev_1' });
    expect(existsSync(legacyHqCredentialsPath())).toBe(false);
    expect(vault.get('cloud:session')).toBe(TOKEN);
  });

  it('prefers cloud.json over a stale hq.json left beside it', () => {
    seedInlineToken(legacyHqCredentialsPath());
    saveCloudCredentials({ ...CREDENTIALS, deviceId: 'dev_current' });

    expect(loadCloudCredentials()?.deviceId).toBe('dev_current');
  });

  it('reads as not signed in when the vault lost the token', () => {
    saveCloudCredentials(CREDENTIALS);
    vault.clear();

    // Better local-only than a plausible-looking credential the relay will reject: the daemon then
    // serves the local network and the user signs in again.
    expect(loadCloudCredentials()).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('drops the token from the vault on sign-out, and both files with it', () => {
    seedInlineToken(legacyHqCredentialsPath());
    saveCloudCredentials(CREDENTIALS);
    clearCloudCredentials();

    expect(existsSync(cloudCredentialsPath())).toBe(false);
    expect(existsSync(legacyHqCredentialsPath())).toBe(false);
    expect(vault.get('cloud:session')).toBeUndefined();
    expect(loadCloudCredentials()).toBeNull();
  });

  it('reads as not signed in when the file is absent', () => {
    expect(loadCloudCredentials()).toBeNull();
  });
});
