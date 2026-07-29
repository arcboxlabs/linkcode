import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hqCredentialsPath } from '../config';
import { logger } from '../logger';
import { HQ_SESSION_REF, secretVault } from '../secrets';
import { isRecord } from './api';

/**
 * HQ sign-in state, persisted at `~/.linkcode/hq.json` by `login` and read at boot to start the
 * tunnel uplink. Absent file = not signed in; the daemon then serves the local network only.
 *
 * The session token is the one part that never touches `hq.json`: it grants full account access, so
 * it lives in the secret vault under {@link HQ_SESSION_REF} (CODE-371) while the file keeps only the
 * origin and device id. A file without a matching vault entry therefore reads as *not signed in* —
 * losing the keyring costs a re-login, never a wrong-but-plausible credential.
 */
export interface HqCredentials {
  /** HQ origin the daemon signed in to. */
  baseUrl: string;
  /** better-auth session token, presented as `Authorization: Bearer …`. Vault-only. */
  sessionToken: string;
  /** This daemon's registered device id — its tunnel host id. */
  deviceId: string;
}

export function loadHqCredentials(): HqCredentials | null {
  const path = hqCredentialsPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Missing or unreadable — not signed in.
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { baseUrl, deviceId, sessionToken } = parsed;
  if (typeof baseUrl !== 'string' || typeof deviceId !== 'string') return null;

  // A token still in the file was written before the vault existed. Move it, then rewrite without
  // it — the exposed copy must not survive the read that noticed it.
  if (typeof sessionToken === 'string') {
    logger.warn(
      { operation: 'hq.credentials' },
      'Moving the HQ session token out of hq.json into the secret vault',
    );
    secretVault().set(HQ_SESSION_REF, sessionToken);
    writeCredentialsFile(path, { baseUrl, deviceId });
    return { baseUrl, deviceId, sessionToken };
  }

  const stored = secretVault().get(HQ_SESSION_REF);
  if (stored === null) {
    logger.warn(
      { operation: 'hq.credentials' },
      'HQ sign-in state has no stored session token; sign in again to restore the uplink',
    );
    return null;
  }
  return { baseUrl, deviceId, sessionToken: stored };
}

/** The token goes to the vault; `hq.json` keeps the non-secret half (written `0600` regardless). */
export function saveHqCredentials(credentials: HqCredentials): void {
  secretVault().set(HQ_SESSION_REF, credentials.sessionToken);
  writeCredentialsFile(hqCredentialsPath(), {
    baseUrl: credentials.baseUrl,
    deviceId: credentials.deviceId,
  });
}

export function clearHqCredentials(): void {
  secretVault().delete(HQ_SESSION_REF);
  rmSync(hqCredentialsPath(), { force: true });
}

function writeCredentialsFile(path: string, fields: Omit<HqCredentials, 'sessionToken'>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fields, null, 2)}\n`, { mode: 0o600 });
}
