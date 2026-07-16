import type {
  AssetInstallEvent,
  InstalledAsset,
  ManagedAssetId,
  ManagedAssetStatus,
} from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
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

// Install events fan out to every subscriber. Per-call `onProgress` is unreliable (install.ts's
// in-flight dedupe keeps only the first caller's callback) — observers must subscribe instead.
export type { AssetInstallEvent } from '@linkcode/schema';

/**
 * Daemon-facing facade (one per daemon): pin → GC → ensure orchestration plus the prober's
 * synchronous managed-binary lookups. Wanted versions resolve once at construction — SDK pins
 * cannot change while the daemon runs; availability is a synchronous on-disk scan, `ensure()` async.
 */
export class AssetManager {
  private readonly descriptors: ReadonlyMap<ManagedAssetId, AssetDescriptor>;
  private readonly wanted = new Map<ManagedAssetId, string | undefined>();
  private readonly subscribers = new Set<(event: AssetInstallEvent) => void>();

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

  /** Live snapshot for the `asset.list` wire resource. */
  statuses(): ManagedAssetStatus[] {
    return [...this.descriptors.values()].map((descriptor) => {
      const version = this.wanted.get(descriptor.id);
      const path = version ? installedPath(descriptor, version) : undefined;
      return {
        id: descriptor.id,
        wantedVersion: version,
        installed: version && path ? { id: descriptor.id, version, path } : undefined,
      };
    });
  }

  /** Synchronous: the managed executable path when the wanted version is fully installed. */
  managedBinary(id: ManagedAssetId): string | undefined {
    const descriptor = this.descriptors.get(id);
    const version = this.wanted.get(id);
    return descriptor && version ? installedPath(descriptor, version) : undefined;
  }

  /**
   * Ensure the wanted version is installed, downloading on miss (deduped per id+version);
   * `undefined` when unpinnable or unknown — callers fall back to detected/SDK resolution.
   */
  async ensure(
    id: ManagedAssetId,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<InstalledAsset | undefined> {
    const descriptor = this.descriptors.get(id);
    const version = this.wanted.get(id);
    if (!descriptor || !version) return undefined;
    const emitProgress = (progress: DownloadProgress) => {
      onProgress?.(progress);
      this.emit({ kind: 'progress', id, ...progress });
    };
    try {
      const installed = await installAsset(descriptor, version, {
        ...this.options,
        onProgress: emitProgress,
      });
      // Concurrent ensures for the same id share one install but emit `installed` once each —
      // subscribers revalidate idempotently, so the duplicate is harmless.
      this.emit({ kind: 'installed', id, installed });
      return installed;
    } catch (err) {
      this.emit({ kind: 'failed', id, error: extractErrorMessage(err) ?? 'install failed' });
      throw err;
    }
  }

  /** Observe every install this manager runs (see {@link AssetInstallEvent}). */
  subscribe(listener: (event: AssetInstallEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private emit(event: AssetInstallEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // A failing observer must not fail the install it is watching (same stance as Hub.send).
      }
    }
  }
}
