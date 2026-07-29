import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cloudCredentialsPath, legacyHqCredentialsPath } from '../config';
import { logger } from '../logger';
import { CLOUD_SESSION_REF, secretVault } from '../secrets';
import { isRecord } from './api';

/**
 * LinkCode Cloud sign-in state, persisted at `~/.linkcode/cloud.json` by `login` and read at boot to
 * start the tunnel uplink. Absent file = not signed in; the daemon then serves the local network only.
 *
 * The session token is the one part that never touches the file: it grants full account access, so
 * it lives in the secret vault under {@link CLOUD_SESSION_REF} (CODE-371) while the file keeps only the
 * origin and device id. A file without a matching vault entry therefore reads as *not signed in* —
 * losing the keyring costs a re-login, never a wrong-but-plausible credential.
 */
export interface CloudCredentials {
  /** Cloud origin the daemon signed in to. */
  baseUrl: string;
  /** better-auth session token, presented as `Authorization: Bearer …`. Vault-only. */
  sessionToken: string;
  /** This daemon's registered device id — its tunnel host id. */
  deviceId: string;
}

export function loadCloudCredentials(): CloudCredentials | null {
  const current = readCredentialsFile(cloudCredentialsPath());
  const legacy = current === null;
  const parsed = legacy ? readCredentialsFile(legacyHqCredentialsPath()) : current;
  if (!isRecord(parsed)) return null;

  const { baseUrl, deviceId, sessionToken } = parsed;
  if (typeof baseUrl !== 'string' || typeof deviceId !== 'string') return null;

  // Two migrations converge here, both driven by whatever the read found: a token still inline
  // predates the vault (CODE-371), and a file under the old name predates the rename. Either way the
  // fix is to rewrite `cloud.json` and drop what the read superseded, without signing anyone out.
  if (typeof sessionToken === 'string' || legacy) {
    if (typeof sessionToken === 'string') secretVault().set(CLOUD_SESSION_REF, sessionToken);
    logger.warn(
      { operation: 'cloud.credentials', legacyFile: legacy },
      'Migrating cloud sign-in state: token to the secret vault, file to cloud.json',
    );
    writeCredentialsFile(cloudCredentialsPath(), { baseUrl, deviceId });
    if (legacy) rmSync(legacyHqCredentialsPath(), { force: true });
  }

  const token =
    typeof sessionToken === 'string' ? sessionToken : secretVault().get(CLOUD_SESSION_REF);
  if (token === null) {
    logger.warn(
      { operation: 'cloud.credentials' },
      'Cloud sign-in state has no stored session token; sign in again to restore the uplink',
    );
    return null;
  }
  return { baseUrl, deviceId, sessionToken: token };
}

/** The token goes to the vault; `cloud.json` keeps the non-secret half (written `0600` regardless). */
export function saveCloudCredentials(credentials: CloudCredentials): void {
  secretVault().set(CLOUD_SESSION_REF, credentials.sessionToken);
  writeCredentialsFile(cloudCredentialsPath(), {
    baseUrl: credentials.baseUrl,
    deviceId: credentials.deviceId,
  });
}

/** Signing out must also take the pre-rename file, or the next load resurrects it. */
export function clearCloudCredentials(): void {
  secretVault().delete(CLOUD_SESSION_REF);
  rmSync(cloudCredentialsPath(), { force: true });
  rmSync(legacyHqCredentialsPath(), { force: true });
}

function readCredentialsFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Missing or unreadable — not signed in through this file.
    return null;
  }
}

function writeCredentialsFile(path: string, fields: Omit<CloudCredentials, 'sessionToken'>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fields, null, 2)}\n`, { mode: 0o600 });
}
