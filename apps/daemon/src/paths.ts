import { homedir } from 'node:os';
import { join } from 'node:path';
import { linkcodeStateDirName, parseProfileName } from '@linkcode/schema';

/** Profile from `LINKCODE_PROFILE`; invalid names fail boot instead of crossing state universes. */
export function daemonProfile(): string | undefined {
  return parseProfileName(process.env.LINKCODE_PROFILE);
}

/** The daemon's profile-aware state directory. Safe to import before logging/Sentry initialization. */
export function daemonStateDir(): string {
  return join(homedir(), linkcodeStateDirName(daemonProfile()));
}

export function telemetryConfigCachePath(): string {
  return join(daemonStateDir(), 'telemetry-config.json');
}
