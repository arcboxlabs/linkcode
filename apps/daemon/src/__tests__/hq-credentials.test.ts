import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real vault reaches the OS keyring; these cases are about what `hq.json` keeps versus what it
// hands to the vault, so stand in an in-memory one. Vault behaviour itself is covered separately.
const vault = vi.hoisted(() => new Map<string, string>());

vi.mock('../secrets', () => ({
  HQ_SESSION_REF: 'hq:session',
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

import { hqCredentialsPath } from '../config';
import { clearHqCredentials, loadHqCredentials, saveHqCredentials } from '../hq/credentials';
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
  return JSON.parse(readFileSync(hqCredentialsPath(), 'utf8')) as Record<string, unknown>;
}

/** An `hq.json` as every daemon before CODE-371 wrote it: token inline, in the clear. */
function seedLegacyFile(): void {
  mkdirSync(join(process.env.HOME ?? '', '.linkcode'), { recursive: true });
  writeFileSync(hqCredentialsPath(), JSON.stringify(CREDENTIALS));
}

describe('HQ credentials', () => {
  it('keeps the session token out of hq.json and reads it back from the vault', () => {
    saveHqCredentials(CREDENTIALS);

    expect(readFile()).toEqual({ baseUrl: CREDENTIALS.baseUrl, deviceId: 'dev_1' });
    expect(readFileSync(hqCredentialsPath(), 'utf8')).not.toContain(TOKEN);
    expect(loadHqCredentials()).toEqual(CREDENTIALS);
  });

  it('migrates a token left inline by an older daemon, off disk on the same read', () => {
    seedLegacyFile();

    // The migration must not sign the user out: the very read that notices the exposed token still
    // returns it, so an in-flight uplink survives the upgrade.
    expect(loadHqCredentials()).toEqual(CREDENTIALS);
    expect(readFile()).toEqual({ baseUrl: CREDENTIALS.baseUrl, deviceId: 'dev_1' });
    expect(vault.get('hq:session')).toBe(TOKEN);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reads as not signed in when the vault lost the token', () => {
    saveHqCredentials(CREDENTIALS);
    vault.clear();

    // Better local-only than a plausible-looking credential the relay will reject: the daemon then
    // serves the local network and the user signs in again.
    expect(loadHqCredentials()).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('drops the token from the vault on sign-out, not just the file', () => {
    saveHqCredentials(CREDENTIALS);
    clearHqCredentials();

    expect(existsSync(hqCredentialsPath())).toBe(false);
    expect(vault.get('hq:session')).toBeUndefined();
    expect(loadHqCredentials()).toBeNull();
  });

  it('reads as not signed in when the file is absent', () => {
    expect(loadHqCredentials()).toBeNull();
  });
});
