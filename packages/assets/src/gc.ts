/// <reference types="node" />
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagedAssetId } from '@linkcode/schema';
import { assetDir } from './paths';

export interface GcReport {
  /** Absolute paths removed (superseded versions and `.tmp-*` orphans). */
  removed: string[];
  /** Absolute paths that could not be removed (win file locks) — retried next boot. */
  skipped: string[];
}

/**
 * Boot-time GC: inside each asset dir, delete everything that is not the wanted version —
 * superseded versions and orphaned `.tmp-*` install dirs. Runs before any agent spawns, so
 * nothing here is in use by this daemon, and the one-per-machine contract means no other
 * daemon's children hold these files. An asset whose pin is `undefined` is skipped entirely:
 * "cannot pin" must never translate into deleting a working install. Strictly best-effort —
 * GC never takes the boot down.
 */
export function collectGarbage(wanted: ReadonlyMap<ManagedAssetId, string | undefined>): GcReport {
  const report: GcReport = { removed: [], skipped: [] };
  for (const [id, version] of wanted) {
    if (!version) continue;
    const dir = assetDir(id);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry === version) continue;
      const target = join(dir, entry);
      try {
        rmSync(target, { recursive: true, force: true });
        report.removed.push(target);
      } catch {
        report.skipped.push(target);
      }
    }
  }
  return report;
}
