/// <reference types="node" />
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import process from 'node:process';
import type { InstalledAsset } from '@linkcode/schema';
import type { AssetDescriptor } from './catalog';
import type { DownloadProgress } from './download';
import { downloadVerified } from './download';
import { extractMember } from './extract';
import { makeTmpDir, versionDir } from './paths';
import type { PlatformKey } from './platform';
import { currentPlatformKey } from './platform';
import type { ResolveArtifactOptions } from './resolve';
import { resolveArtifact } from './resolve';

/**
 * Install pipeline: resolve → download+verify → extract — all inside a transient `.tmp-*`
 * sibling — then publish with one same-volume `rename`. A crash at any point leaves only a
 * `.tmp-*` orphan for boot GC; a reader can never observe a partial version dir.
 */

export interface InstallOptions extends ResolveArtifactOptions {
  onProgress?: (progress: DownloadProgress) => void;
}

function binaryName(descriptor: AssetDescriptor): string {
  return process.platform === 'win32' ? `${descriptor.binaryBase}.exe` : descriptor.binaryBase;
}

/**
 * Every file a complete install carries: the executable plus the platform source's extra
 * members under their basenames (tar members are always `/`-separated).
 */
function expectedFiles(descriptor: AssetDescriptor, platform?: PlatformKey): string[] {
  const key = platform ?? currentPlatformKey();
  const extras = (key && descriptor.artifacts[key]?.extraMembers) || [];
  return [binaryName(descriptor), ...extras.map((member) => posix.basename(member))];
}

/** The canonical executable location: `<store>/<id dirs>/<version>/<binary>`. */
export function installedBinaryPath(descriptor: AssetDescriptor, version: string): string {
  return join(versionDir(descriptor.id, version), binaryName(descriptor));
}

/**
 * Synchronous already-installed check — feeds the prober's sync spawn-path resolution. The
 * executable's presence alone decides spawnability; extra members missing from an install made
 * under an older catalog degrade that asset's optional features, never its spawn path.
 */
export function installedPath(descriptor: AssetDescriptor, version: string): string | undefined {
  const file = installedBinaryPath(descriptor, version);
  return existsSync(file) ? file : undefined;
}

/** True when the version dir holds every file the current catalog expects. */
export function installedComplete(
  descriptor: AssetDescriptor,
  version: string,
  platform?: PlatformKey,
): boolean {
  const dir = versionDir(descriptor.id, version);
  return expectedFiles(descriptor, platform).every((file) => existsSync(join(dir, file)));
}

/** Concurrent `installAsset` calls for the same id+version share one in-flight install. */
const inFlight = new Map<string, Promise<InstalledAsset>>();

export function installAsset(
  descriptor: AssetDescriptor,
  version: string,
  options: InstallOptions = {},
): Promise<InstalledAsset> {
  const key = `${descriptor.id}@${version}`;
  const running = inFlight.get(key);
  if (running) return running;
  const task = doInstall(descriptor, version, options).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function doInstall(
  descriptor: AssetDescriptor,
  version: string,
  options: InstallOptions,
): Promise<InstalledAsset> {
  const installed = installedPath(descriptor, version);
  if (installed && installedComplete(descriptor, version, options.platform)) {
    return { id: descriptor.id, version, path: installed };
  }
  const artifact = await resolveArtifact(descriptor, version, options);
  const tmp = makeTmpDir(descriptor.id);
  try {
    const archive = join(tmp, 'artifact');
    await downloadVerified(artifact, archive, {
      onProgress: options.onProgress,
      retry: options.retry,
    });
    const stage = join(tmp, 'install');
    await extractMember(
      archive,
      artifact.format,
      artifact.member,
      join(stage, binaryName(descriptor)),
    );
    for (const member of artifact.extraMembers ?? []) {
      await extractMember(archive, artifact.format, member, join(stage, posix.basename(member)));
    }
    publish(stage, versionDir(descriptor.id, version), expectedFiles(descriptor, options.platform));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { id: descriptor.id, version, path: installedBinaryPath(descriptor, version) };
}

/**
 * Publish the staged install with one same-volume atomic rename. When the version dir already
 * exists — a lost race against a concurrent install (hash-verified identical bytes) or an
 * install made before the catalog declared extra members — the missing files are backfilled
 * from the stage instead, each landing via its own same-volume rename; files already present
 * are never touched (the executable may be running).
 */
function publish(stage: string, dest: string, expected: readonly string[]): void {
  try {
    renameSync(stage, dest);
  } catch (error) {
    if (!existsSync(dest)) throw error;
    for (const file of expected) {
      const target = join(dest, file);
      if (existsSync(target)) continue;
      try {
        renameSync(join(stage, file), target);
      } catch (raceError) {
        // A concurrent backfill landed this exact file between the check and the rename.
        if (!existsSync(target)) throw raceError;
      }
    }
  }
}
