import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger';

/**
 * Resolve the `linkcode-sim` sidecar binary, mirroring the PTY sidecar's order: the explicit
 * override (set by the desktop supervisor from `process.resourcesPath`) always wins; dev falls
 * back to the workspace release build via this file's known depth under `src/`. That depth breaks
 * in the flat tsup `dist/` bundle, so production trusts only the override. Returns `''` off
 * macOS — Apple's simulator does not exist there, so nothing is logged either.
 */
export function resolveSimSidecarPath(): string {
  if (process.platform !== 'darwin') return '';
  const override = process.env.LINKCODE_SIM_SIDECAR_PATH;
  if (override) return override;
  const here = fileURLToPath(import.meta.url);
  // tsx runs this file straight from source (`.ts`); a tsup bundle is emitted as `.js`/`.mjs`.
  if (here.endsWith('.ts')) {
    // Dev: this file lives at apps/daemon/src/sim, so the repo root is four levels up.
    const repoRoot = join(dirname(here), '..', '..', '..', '..');
    return join(repoRoot, 'target', 'release', 'linkcode-sim');
  }
  logger.warn(
    { operation: 'sim.resolve' },
    'sim sidecar is not configured; simulators will be unavailable',
  );
  return '';
}
