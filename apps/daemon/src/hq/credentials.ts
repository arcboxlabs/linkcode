import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hqCredentialsPath } from '../config';
import { isRecord } from './api';

/**
 * HQ sign-in state, persisted at `~/.linkcode/hq.json` by `login` and read at boot to start the
 * tunnel uplink. Absent file = not signed in; the daemon then serves the local network only.
 */
export interface HqCredentials {
  /** HQ origin the daemon signed in to. */
  baseUrl: string;
  /** better-auth session token, presented as `Authorization: Bearer …`. */
  sessionToken: string;
  /** This daemon's registered device id — its tunnel host id. */
  deviceId: string;
}

export function loadHqCredentials(): HqCredentials | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(hqCredentialsPath(), 'utf8'));
    if (
      isRecord(parsed) &&
      typeof parsed.baseUrl === 'string' &&
      typeof parsed.sessionToken === 'string' &&
      typeof parsed.deviceId === 'string'
    ) {
      return {
        baseUrl: parsed.baseUrl,
        sessionToken: parsed.sessionToken,
        deviceId: parsed.deviceId,
      };
    }
  } catch {
    // Missing or unreadable — not signed in.
  }
  return null;
}

/** Written 0600 — the session token grants full account access. */
export function saveHqCredentials(credentials: HqCredentials): void {
  const path = hqCredentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

export function clearHqCredentials(): void {
  rmSync(hqCredentialsPath(), { force: true });
}
