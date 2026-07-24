import type { ManagedAssetArtifact } from '@linkcode/schema';
import { managedAssetKey } from '@linkcode/schema';
import type { BinaryAssetDescriptor } from './catalog';
import { UnsupportedPlatformError } from './errors';
import type { PlatformKey } from './platform';
import { currentPlatformKey } from './platform';
import { fetchNpmDist } from './registry-client';

export interface ResolveArtifactOptions {
  /** Defaults to the running host; a test seam and a future cross-platform hook. */
  platform?: PlatformKey;
  registries?: readonly string[];
  /** Per-source fetch retry count, forwarded to make-fetch-happen. */
  retry?: number;
}

/** Resolve the concrete downloadable artifact for one asset version on one platform. */
export async function resolveArtifact(
  descriptor: BinaryAssetDescriptor,
  version: string,
  options: ResolveArtifactOptions = {},
): Promise<ManagedAssetArtifact> {
  const platform = options.platform ?? currentPlatformKey();
  const source = platform ? descriptor.artifacts[platform] : undefined;
  if (!source) {
    throw new UnsupportedPlatformError(
      `${managedAssetKey(descriptor.id)} has no artifact for ${platform ?? 'this platform'}`,
    );
  }
  if (source.kind === 'baked') {
    const { url, integrity, size, format, member, extraMembers } = source;
    return { urls: [url], integrity, size, format, member, extraMembers };
  }
  const dist = await fetchNpmDist(source.packageName, source.versionKey?.(version) ?? version, {
    registries: options.registries,
    retry: options.retry,
  });
  return {
    urls: [dist.tarball],
    integrity: dist.integrity,
    format: source.format,
    member: source.member,
    extraMembers: source.extraMembers,
  };
}
