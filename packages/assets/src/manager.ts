import type { InstalledAsset, ManagedAssetId } from '@linkcode/schema';
import type { AssetDescriptor } from './catalog';
import { CATALOG } from './catalog';
import type { DownloadProgress } from './download';
import type { GcReport } from './gc';
import { collectGarbage } from './gc';
import type { InstallOptions } from './install';
import { installAsset, installedPath } from './install';
import { wantedVersion } from './version-pin';

export interface AssetManagerOptions extends InstallOptions {
  /** Test seam — replaces the built-in catalog. */
  catalog?: readonly AssetDescriptor[];
  /** Test seam — anchor file for SDK version-pin resolution. */
  pinFrom?: string;
}

/**
 * The daemon-facing facade: one instance per daemon owns pin → GC → ensure orchestration and
 * answers the prober's synchronous managed-binary lookups. Wanted versions are resolved once
 * at construction — SDK pins cannot change while this daemon runs. `ensure()` is async and
 * meant for background warm-up or on-demand installs; boot stays fast because availability
 * comes from the synchronous already-on-disk scan.
 */
export class AssetManager {
  private readonly descriptors: ReadonlyMap<ManagedAssetId, AssetDescriptor>;
  private readonly wanted = new Map<ManagedAssetId, string | undefined>();

  constructor(private readonly options: AssetManagerOptions = {}) {
    const catalog = options.catalog ?? Object.values(CATALOG);
    this.descriptors = new Map(catalog.map((descriptor) => [descriptor.id, descriptor]));
    for (const descriptor of this.descriptors.values()) {
      this.wanted.set(descriptor.id, wantedVersion(descriptor.version, options.pinFrom));
    }
  }

  /** The version this host should run, when determinable. */
  wantedVersionOf(id: ManagedAssetId): string | undefined {
    return this.wanted.get(id);
  }

  /** Drop superseded versions and tmp orphans. Best-effort; never throws. */
  gcAtBoot(): GcReport {
    return collectGarbage(this.wanted);
  }

  /** Synchronous: the managed executable path when the wanted version is fully installed. */
  managedBinary(id: ManagedAssetId): string | undefined {
    const descriptor = this.descriptors.get(id);
    const version = this.wanted.get(id);
    return descriptor && version ? installedPath(descriptor, version) : undefined;
  }

  /**
   * Ensure the wanted version is installed, downloading on miss (deduped per id+version).
   * `undefined` when the asset cannot be pinned or is unknown — callers fall back to
   * detected/SDK resolution.
   */
  async ensure(
    id: ManagedAssetId,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<InstalledAsset | undefined> {
    const descriptor = this.descriptors.get(id);
    const version = this.wanted.get(id);
    if (!descriptor || !version) return undefined;
    return installAsset(descriptor, version, { ...this.options, onProgress });
  }
}
