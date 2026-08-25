import type {
  InstalledLinkCodePlugin,
  LinkCodeMarketplaceId,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
} from '@linkcode/schema';

/** An installed LinkCode plugin: its install record plus the parsed manifest. */
export interface InstalledLinkCodePluginEntry {
  readonly installed: InstalledLinkCodePlugin;
  readonly manifest: LinkCodePluginManifest;
}

/** A stored setting value: the restricted JSON-Schema subset a manifest may declare. */
export type PluginConfigValue = string | number | boolean;

/** Per-key patch over one plugin's settings; untouched keys keep their stored value. */
export interface PluginConfigPatch {
  readonly set?: Readonly<Record<string, PluginConfigValue>>;
  readonly remove?: readonly string[];
}

/**
 * Daemon-owned LinkCode plugin store. Enumerates installed plugins (manifest + install record),
 * reads/writes their declared settings (non-secret in `config.json`, secret in the vault — the
 * manifest's `secret` flag decides), and installs/uninstalls releases (download + SRI + extract).
 *
 * The Engine reads manifests at session start to inject an MCP-server component's command, args,
 * and env into StartOptions, and services the `plugin-config.*` wire from the masked settings view.
 */
export interface LinkCodePluginStore {
  list(): InstalledLinkCodePluginEntry[];
  get(pluginId: string): InstalledLinkCodePluginEntry | undefined;
  /** Merged effective setting values (non-secret from config, secret from the vault), with each
   * manifest-declared `default` folded in when the field has no stored value. */
  getSettings(pluginId: string): Record<string, PluginConfigValue>;
  /** Per-key patch; the store splits secret vs non-secret per the manifest. */
  setSettings(pluginId: string, patch: PluginConfigPatch): Promise<void>;
  install(
    release: LinkCodePluginRelease,
    marketplaceId: LinkCodeMarketplaceId,
  ): Promise<InstalledLinkCodePluginEntry>;
  uninstall(pluginId: string): Promise<void>;
}

/** In-memory store for tests and standalone Engine use; no persistence, no install. */
export class InMemoryLinkCodePluginStore implements LinkCodePluginStore {
  private readonly entries = new Map<string, InstalledLinkCodePluginEntry>();
  private readonly values = new Map<string, Map<string, PluginConfigValue>>();

  seed(
    entry: InstalledLinkCodePluginEntry,
    settings: Record<string, PluginConfigValue> = {},
  ): void {
    this.entries.set(entry.installed.id, entry);
    const map = new Map<string, PluginConfigValue>();
    for (const [k, v] of Object.entries(settings)) map.set(k, v);
    this.values.set(entry.installed.id, map);
  }

  list(): InstalledLinkCodePluginEntry[] {
    return [...this.entries.values()];
  }

  get(pluginId: string): InstalledLinkCodePluginEntry | undefined {
    return this.entries.get(pluginId);
  }

  getSettings(pluginId: string): Record<string, PluginConfigValue> {
    const merged = Object.fromEntries(this.values.get(pluginId) ?? []);
    const settings = this.entries.get(pluginId)?.manifest.settings;
    for (const [fieldId, field] of Object.entries(settings ?? {})) {
      // Mirrors the daemon store: defaults fold in for missing values, but never for secrets.
      if (field.secret === true) continue;
      if (!(fieldId in merged) && field.default !== undefined) merged[fieldId] = field.default;
    }
    return merged;
  }

  setSettings(pluginId: string, patch: PluginConfigPatch): Promise<void> {
    let map = this.values.get(pluginId);
    if (!map) {
      map = new Map();
      this.values.set(pluginId, map);
    }
    if (patch.remove) for (const key of patch.remove) map.delete(key);
    if (patch.set) for (const [k, v] of Object.entries(patch.set)) map.set(k, v);
    return Promise.resolve();
  }

  install(
    _release: LinkCodePluginRelease,
    _marketplaceId: LinkCodeMarketplaceId,
  ): Promise<InstalledLinkCodePluginEntry> {
    return Promise.reject(new Error('InMemoryLinkCodePluginStore cannot install'));
  }

  uninstall(pluginId: string): Promise<void> {
    this.entries.delete(pluginId);
    this.values.delete(pluginId);
    return Promise.resolve();
  }
}
