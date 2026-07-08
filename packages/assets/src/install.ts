/// <reference types="node" />
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import type { InstalledAsset } from '@linkcode/schema';
import type { AssetDescriptor } from './catalog';
import type { DownloadProgress } from './download';
import { downloadVerified } from './download';
import { extractMember } from './extract';
import { makeTmpDir, versionDir } from './paths';
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

/** The canonical executable location: `<store>/<id dirs>/<version>/<binary>`. */
export function installedBinaryPath(descriptor: AssetDescriptor, version: string): string {
  return join(versionDir(descriptor.id, version), binaryName(descriptor));
}

/** Synchronous already-installed check — feeds the prober's sync spawn-path resolution. */
export function installedPath(descriptor: AssetDescriptor, version: string): string | undefined {
  const file = installedBinaryPath(descriptor, version);
  return existsSync(file) ? file : undefined;
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
  if (installed) return { id: descriptor.id, version, path: installed };
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
    publish(stage, versionDir(descriptor.id, version));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { id: descriptor.id, version, path: installedBinaryPath(descriptor, version) };
}

function publish(stage: string, dest: string): void {
  try {
    renameSync(stage, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A concurrent install already published this version — its bytes are hash-verified
    // identical to ours, so losing the rename race is success.
    const raced = code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM';
    if (raced && existsSync(dest)) return;
    throw error;
  }
}
