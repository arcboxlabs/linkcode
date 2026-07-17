/// <reference types="node" />
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import type { InstalledAsset } from '@linkcode/schema';
import pMap from 'p-map';
import type { AssetDescriptor, NpmClosureAssetDescriptor } from './catalog';
import { isClosureDescriptor } from './catalog';
import type { ClosurePackage } from './closure';
import { closurePackagesForHost, npmTarballUrls } from './closure';
import type { DownloadProgress } from './download';
import { downloadVerified } from './download';
import { extractMember, extractPackageTree } from './extract';
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

function binaryName(descriptor: { binaryBase: string }): string {
  return process.platform === 'win32' ? `${descriptor.binaryBase}.exe` : descriptor.binaryBase;
}

/** The canonical install target: the executable, or a closure's entry module. */
export function installedAssetPath(descriptor: AssetDescriptor, version: string): string {
  const dir = versionDir(descriptor.id, version);
  return isClosureDescriptor(descriptor)
    ? join(dir, descriptor.closure.entry)
    : join(dir, binaryName(descriptor));
}

/** Synchronous already-installed check — feeds the prober's sync spawn-path resolution. */
export function installedPath(descriptor: AssetDescriptor, version: string): string | undefined {
  const file = installedAssetPath(descriptor, version);
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
  const tmp = makeTmpDir(descriptor.id);
  try {
    const stage = join(tmp, 'install');
    if (isClosureDescriptor(descriptor)) {
      await stageClosure(descriptor, stage, tmp, options);
    } else {
      const artifact = await resolveArtifact(descriptor, version, options);
      const archive = join(tmp, 'artifact');
      await downloadVerified(artifact, archive, {
        onProgress: options.onProgress,
        retry: options.retry,
      });
      await extractMember(
        archive,
        artifact.format,
        artifact.member,
        join(stage, binaryName(descriptor)),
      );
    }
    publish(stage, versionDir(descriptor.id, version));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { id: descriptor.id, version, path: installedAssetPath(descriptor, version) };
}

const CLOSURE_DOWNLOAD_CONCURRENCY = 8;

/**
 * Stage a whole npm closure: every host-relevant package tarball is downloaded (SRI-verified)
 * and extracted at its manifest path, all inside the staging dir the caller publishes with one
 * atomic rename. A name@version needed at several layout paths downloads once and extracts per
 * path. Progress aggregates bytes across the concurrent downloads; the total is unknown up
 * front (the lockfile records no sizes), so `totalBytes` stays absent.
 */
async function stageClosure(
  descriptor: NpmClosureAssetDescriptor,
  stage: string,
  tmp: string,
  options: InstallOptions,
): Promise<void> {
  const byTarball = new Map<string, ClosurePackage[]>();
  for (const pkg of closurePackagesForHost(descriptor.closure, process.platform, process.arch)) {
    const key = `${pkg.name}@${pkg.version}`;
    const targets = byTarball.get(key);
    if (targets) targets.push(pkg);
    else byTarball.set(key, [pkg]);
  }
  let receivedTotal = 0;
  await pMap(
    [...byTarball.values()],
    async (targets, index) => {
      const pkg = targets[0];
      const archive = join(tmp, `pkg-${index}.tgz`);
      let lastReceived = 0;
      await downloadVerified(
        {
          urls: npmTarballUrls(pkg.name, pkg.version, options.registries),
          integrity: pkg.integrity,
          format: 'tgz',
        },
        archive,
        {
          retry: options.retry,
          onProgress({ receivedBytes }) {
            receivedTotal += receivedBytes - lastReceived;
            lastReceived = receivedBytes;
            options.onProgress?.({ receivedBytes: receivedTotal });
          },
        },
      );
      for (const target of targets) {
        // eslint-disable-next-line no-await-in-loop -- same archive, sequential extract targets
        await extractPackageTree(archive, join(stage, target.path));
      }
      // 200+ tarballs would otherwise accumulate in tmp for the whole install.
      rmSync(archive, { force: true });
    },
    { concurrency: CLOSURE_DOWNLOAD_CONCURRENCY },
  );
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
