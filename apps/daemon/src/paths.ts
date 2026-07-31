import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProductChannel } from '@linkcode/schema';
import { linkcodeStateDirName, parseProfileName } from '@linkcode/schema';
import { resolveProductChannel } from '@linkcode/schema/product';

/** Profile from `LINKCODE_PROFILE`; invalid names fail boot instead of crossing state universes. */
export function daemonProfile(): string | undefined {
  return parseProfileName(process.env.LINKCODE_PROFILE);
}

/**
 * This build's channel, which picks the whole on-disk universe (CODE-460). `LINKCODE_CHANNEL` —
 * injected by the desktop supervisor — outranks the build-time marker, because the devshell pack
 * ships a tsup bundle stamped `release` inside a `development` shell. tsup replaces
 * `process.env.LINKCODE_BUILD_CHANNEL` with a literal (see its `define`); running the TS source
 * leaves it undefined, so a dev daemon defaults to `development` with nothing to remember.
 *
 * Resolved on every call, never cached at module load: `instrument.ts` derives a state path in its
 * module body, and `--import` runs it before `index.ts` — anything hung off entry-point side
 * effects would capture the wrong universe (the CODE-166 bug class).
 */
export function daemonChannel(): ProductChannel {
  return resolveProductChannel(process.env.LINKCODE_CHANNEL, process.env.LINKCODE_BUILD_CHANNEL);
}

/** The daemon's channel × profile state directory. Safe to import before logging/Sentry initialization. */
export function daemonStateDir(): string {
  return join(homedir(), linkcodeStateDirName(daemonChannel(), daemonProfile()));
}

export function telemetryConfigCachePath(): string {
  return join(daemonStateDir(), 'telemetry-config.json');
}

/**
 * The daemon's secret store (CODE-371) — every long-lived credential, keyed by ref and encrypted
 * under an OS-keyring master key. Lives here rather than in `config.ts` because `config.ts` reads
 * the vault to rehydrate provider/account credentials, and the path must sit below that.
 */
export function secretsFilePath(): string {
  return join(daemonStateDir(), 'secrets.json');
}
