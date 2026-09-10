import type {
  InstalledLinkCodePlugin,
  LinkCodeMarketplaceId,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
  LinkCodePluginSettingField,
  LinkCodePluginSettings,
} from '@linkcode/schema';
import { isValidPluginSettingValue } from '@linkcode/schema';

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

/** A patch rejected by the daemon's manifest validation; surfaced as `invalid_request`, never
 * persisted. Distinct from an I/O failure, which is an `OperationError`. */
export class PluginConfigValidationError extends Error {
  override name = 'PluginConfigValidationError';
}

/**
 * The daemon-side authority for `plugin-config.set`: the wire only guarantees primitive values, so
 * every store validates the patch against the manifest before persisting — each `set` value must
 * fit its declared field (type, enum membership), and the post-patch state must satisfy every
 * `required` field. `current` is the store's merged effective values (defaults folded, stored
 * secrets included), exactly what {@link LinkCodePluginStore.getSettings} returns.
 */
export function validatePluginConfigPatch(
  settings: LinkCodePluginSettings,
  current: Readonly<Record<string, PluginConfigValue>>,
  patch: PluginConfigPatch,
): void {
  if (patch.set) {
    const setEntries = Object.entries(patch.set);
    for (let i = 0, len = setEntries.length; i < len; i++) {
      const [fieldId, value] = setEntries[i];
      const field: LinkCodePluginSettingField | undefined = settings[fieldId];
      // eslint-disable-next-line sukka/prefer-nullthrow -- the write boundary requires the typed error the engine maps to invalid_request, not nullthrow's TypeError
      if (field === undefined) {
        throw new PluginConfigValidationError(`Unknown plugin setting: ${fieldId}`);
      }
      if (!isValidPluginSettingValue(field, value)) {
        throw new PluginConfigValidationError(
          `Invalid value for plugin setting ${fieldId}: expected ${field.type}`,
        );
      }
      // '' passes the type check but carries no data, and the required check below only tests
      // membership — so a non-UI caller could satisfy it with an empty string. Blank is "remove",
      // never a value: reject at the authority (the UI already converts blanks to removals).
      if (value === '') {
        throw new PluginConfigValidationError(
          field.secret === true
            ? `Plugin setting ${fieldId} must not be an empty secret`
            : `Plugin setting ${fieldId} must not be an empty value`,
        );
      }
    }
  }
  const effective: Record<string, PluginConfigValue> = { ...current };
  if (patch.remove != null) {
    for (let i = 0, len = patch.remove.length; i < len; i++) {
      const fieldId = patch.remove[i];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the patch is a per-key removal over a plain record
      delete effective[fieldId];
    }
  }
  if (patch.set != null) {
    const setEntries = Object.entries(patch.set);
    for (let i = 0, len = setEntries.length; i < len; i++) {
      const [fieldId, value] = setEntries[i];
      effective[fieldId] = value;
    }
  }
  // A removal of a defaulted field re-exposes the manifest default on the next read, so fold it
  // back in here rather than rejecting the patch as missing a required value.
  const settingEntries = Object.entries(settings);
  for (let i = 0, len = settingEntries.length; i < len; i++) {
    const [fieldId, field] = settingEntries[i];
    if (!field.secret && field.default !== undefined && !(fieldId in effective)) {
      effective[fieldId] = field.default;
    }
  }
  for (let i = 0, len = settingEntries.length; i < len; i++) {
    const [fieldId, field] = settingEntries[i];
    if (field.required === true && !(fieldId in effective)) {
      throw new PluginConfigValidationError(`Missing required plugin setting: ${fieldId}`);
    }
  }
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
    const seedEntries = Object.entries(settings);
    for (let i = 0, len = seedEntries.length; i < len; i++) {
      const [k, v] = seedEntries[i];
      map.set(k, v);
    }
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
    if (settings != null) {
      const settingEntries = Object.entries(settings);
      for (let i = 0, len = settingEntries.length; i < len; i++) {
        const [fieldId, field] = settingEntries[i];
        // Mirrors the daemon store: defaults fold in for missing values, but never for secrets.
        if (field.secret === true) continue;
        if (!(fieldId in merged) && field.default !== undefined) merged[fieldId] = field.default;
      }
    }
    return merged;
  }

  setSettings(pluginId: string, patch: PluginConfigPatch): Promise<void> {
    // Same manifest validation as the daemon store: tests exercise the real write contract.
    const settings = this.entries.get(pluginId)?.manifest.settings ?? {};
    validatePluginConfigPatch(settings, this.getSettings(pluginId), patch);
    let map = this.values.get(pluginId);
    if (!map) {
      map = new Map();
      this.values.set(pluginId, map);
    }
    if (patch.remove) {
      for (let i = 0, len = patch.remove.length; i < len; i++) {
        const key = patch.remove[i];
        map.delete(key);
      }
    }
    if (patch.set) {
      const setEntries = Object.entries(patch.set);
      for (let i = 0, len = setEntries.length; i < len; i++) {
        const [k, v] = setEntries[i];
        map.set(k, v);
      }
    }
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
