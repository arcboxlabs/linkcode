/** Product filesystem identity — the single place a fork renames its on-disk footprint
 * (docs/FORKING.md). Zero-dependency and zod-free so the sandboxed Electron preload can
 * import it (same contract as `daemon-runtime.ts`). */

/** Base name of the per-user state directory under `$HOME` (`~/.linkcode`); profiles use
 * the `-<name>` sibling — see `linkcodeStateDirName` in `daemon-runtime.ts`. */
export const STATE_DIR_BASENAME = '.linkcode';

/** Directory under `$HOME` holding user workspaces and the daemon's chat root (`~/LinkCode`).
 * Shared across channels and profiles on purpose. */
export const WORKSPACES_DIRNAME = 'LinkCode';

/** Directory name under the platform data dir holding the managed-asset store; XDG (linux)
 * paths use the lowercase form. */
export const DATA_DIRNAME = 'LinkCode';
