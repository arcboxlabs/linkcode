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
 * Boot-time GC: inside each asset dir, delete superseded versions and orphaned `.tmp-*` install
 * dirs. Runs before any agent spawns, so nothing here is in use by this daemon, and the
 * one-per-machine contract means no other daemon's children hold these files. An asset whose pin
 * is `undefined` is skipped entirely: "cannot pin" must never translate into deleting a working
 * install. Superseded versions are deleted only once the wanted version is on disk — until the
 * replacement lands they are the only evidence of the user's install consent (CODE-221), and an
 * offline refresh failure must not erase it. Strictly best-effort — GC never takes the boot down.
 */
export function collectGarbage(
  wanted: Iterable<Readonly<{ id: ManagedAssetId; version?: string }>>,
): GcReport {
  const report: GcReport = { removed: [], skipped: [] };
  for (const { id, version } of wanted) {
    if (!version) continue;
    const dir = assetDir(id);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report.skipped.push(dir);
      continue;
    }
    // Version dirs publish via atomic rename, so presence = a complete install.
    const wantedInstalled = entries.includes(version);
    for (const entry of entries) {
      if (entry === version) continue;
      if (!wantedInstalled && !entry.startsWith('.tmp-')) continue;
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
