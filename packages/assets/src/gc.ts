/// <reference types="node" />
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagedAssetId } from '@linkcode/schema';
import { assetDir } from './paths';

export interface GcReport {
  /** Absolute paths removed (superseded versions and `.tmp-*` orphans). */
  removed: string[];
  /** Absolute paths that could not be inspected or removed — retried next boot. */
  skipped: string[];
}

/**
 * Boot-time GC: delete everything in each asset dir that is not the wanted version (superseded
 * versions, `.tmp-*` orphans); safe because it runs before any spawn on a one-per-machine daemon.
 * An `undefined` pin skips the asset — "cannot pin" must never delete a working install.
 * Strictly best-effort: GC never takes the boot down.
 */
export function collectGarbage(wanted: ReadonlyMap<ManagedAssetId, string | undefined>): GcReport {
  const report: GcReport = { removed: [], skipped: [] };
  for (const [id, version] of wanted) {
    if (!version) continue;
    const dir = assetDir(id);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report.skipped.push(dir);
      continue;
    }
    for (const entry of entries) {
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
