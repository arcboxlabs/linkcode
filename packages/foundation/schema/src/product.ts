/** Product filesystem identity — the single place a fork renames its on-disk footprint
 * (docs/FORKING.md). Zero-dependency and zod-free so the sandboxed Electron preload can
 * import it (same contract as `daemon-runtime.ts`). */

/**
 * Build lineage, and with it an entire parallel on-disk footprint: `development` is any build
 * that is not the released app. Every path below forks on it, so a local build can never share
 * a state directory, a port, or a `daemon.db` with an installed release (CODE-460).
 */
export const PRODUCT_CHANNELS = ['release', 'development'] as const;

export type ProductChannel = (typeof PRODUCT_CHANNELS)[number];

/** Absent/empty → `undefined` so the caller's own default applies; an unrecognized value throws,
 * because a typo in an injected `LINKCODE_CHANNEL` must abort rather than silently fork state. */
export function parseProductChannel(raw: string | undefined): ProductChannel | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isProductChannel(raw)) {
    throw new TypeError(
      `invalid channel ${JSON.stringify(raw)}: expected one of ${PRODUCT_CHANNELS.join(', ')}`,
    );
  }
  return raw;
}

function isProductChannel(raw: string): raw is ProductChannel {
  return (PRODUCT_CHANNELS as readonly string[]).includes(raw);
}

/**
 * The channel a host process runs in: an injected value (the desktop supervisor's
 * `LINKCODE_CHANNEL`) outranks the build-time stamp, and a build with neither is a working copy.
 *
 * Takes two strings rather than an env object on purpose: the stamp reaches a bundle through
 * esbuild's `define`, which only substitutes a literal `process.env.LINKCODE_BUILD_CHANNEL` at the
 * call site. Passing `process.env` here would defeat it and every bundle would read as development.
 */
export function resolveProductChannel(
  injected: string | undefined,
  buildStamp: string | undefined,
): ProductChannel {
  return parseProductChannel(injected) ?? parseProductChannel(buildStamp) ?? 'development';
}

const BRAND = 'LinkCode';
const DEVELOPMENT_BRAND = `${BRAND} Development`;
const STATE_BRAND = '.linkcode';

/**
 * Base name of the per-user state directory under `$HOME` (`~/.linkcode`); profiles use the
 * `-<name>` sibling — see `linkcodeStateDirName` in `daemon-runtime.ts`.
 *
 * The development suffix is dot-separated on purpose: `PROFILE_NAME_PATTERN` forbids dots, so
 * `.linkcode.development` can never collide with the sibling `--profile=development` would pick.
 */
export function stateDirBasename(channel: ProductChannel): string {
  return channel === 'development' ? `${STATE_BRAND}.development` : STATE_BRAND;
}

/** Directory under `$HOME` holding user workspaces and the daemon's chat root (`~/LinkCode`).
 * Forks by channel only — profiles of one channel share their workspaces on purpose. */
export function workspacesDirName(channel: ProductChannel): string {
  return channel === 'development' ? DEVELOPMENT_BRAND : BRAND;
}

/** Directory name under the platform data dir holding the managed-asset store. Mirrors the
 * desktop shell's `APP_NAME`, so a channel's store sits beside that channel's `userData`. */
export function dataDirName(channel: ProductChannel): string {
  return channel === 'development' ? DEVELOPMENT_BRAND : BRAND;
}

/** XDG (linux) flavour of {@link dataDirName}: lowercase, and hyphenated instead of spaced. */
export function xdgDataDirName(channel: ProductChannel): string {
  return channel === 'development' ? 'linkcode-development' : 'linkcode';
}
