import type { LinkCodePluginSettings } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import type {
  InstalledLinkCodePluginEntry,
  LinkCodePluginStore,
  PluginConfigValue,
} from './linkcode-store';
import { PluginConfigValidationError } from './linkcode-store';

/** A plugin's settings as the wire exposes them: the manifest's field schemas plus the non-secret
 * values. Secret fields appear in `settings` (so the client renders a masked input) but never in
 * `values` — the same masked-edit contract custom-MCP uses; `configuredSecrets` carries presence
 * only, so the client can tell "blank keeps the stored secret" from "no secret stored yet". Every
 * installed plugin appears here, even one declaring no settings (`settings: {}`), so this list
 * doubles as the installed inventory: "has settings" must never decide "is installed". */
export interface PluginConfigView {
  readonly id: string;
  readonly version: string;
  readonly settings: LinkCodePluginSettings;
  readonly values: Readonly<Record<string, PluginConfigValue>>;
  /** Ids of secret fields with a stored value — presence bits only, never the values. */
  readonly configuredSecrets: readonly string[];
}

/**
 * Services the `plugin-config.*` wire plane from the {@link LinkCodePluginStore}: masked reads and
 * per-key patch writes. The store owns persistence and the secret/non-secret split; this service
 * only masks and validates against the store's own manifest source.
 */
export class PluginConfigService {
  constructor(private readonly store: LinkCodePluginStore) {}

  list(): PluginConfigView[] {
    return this.store
      .list()
      .map((entry) => viewFor(entry, this.store.getSettings(entry.installed.id)));
  }

  /** Per-key patch; the store splits secret vs non-secret per the manifest. */
  applyPatch(
    pluginId: string,
    patch: { set?: Readonly<Record<string, PluginConfigValue>>; remove?: readonly string[] },
  ): Effect.Effect<void, RequestError | OperationError> {
    return Effect.suspend((): Effect.Effect<void, RequestError | OperationError> => {
      if (this.store.get(pluginId) === undefined) {
        return Effect.fail(
          new RequestError({ code: 'not_found', message: `Unknown plugin: ${pluginId}` }),
        );
      }
      return Effect.tryPromise({
        try: async () => {
          await this.store.setSettings(pluginId, patch);
        },
        catch: (cause) =>
          cause instanceof PluginConfigValidationError
            ? new RequestError({ code: 'invalid_request', message: cause.message })
            : new OperationError({
                subsystem: 'store',
                operation: 'plugin-config.set',
                publicMessage: 'Failed to persist the plugin config',
                cause,
              }),
      });
    });
  }

  /** Post-patch masked re-read, so the client patches one cache entry instead of re-listing. */
  maskedView(pluginId: string): Pick<PluginConfigView, 'values' | 'configuredSecrets'> {
    const entry = this.store.get(pluginId);
    if (entry === undefined) return { values: {}, configuredSecrets: [] };
    const merged = this.store.getSettings(pluginId);
    return {
      values: maskValues(entry, merged),
      configuredSecrets: configuredSecrets(entry, merged),
    };
  }
}

function viewFor(
  entry: InstalledLinkCodePluginEntry,
  merged: Record<string, PluginConfigValue>,
): PluginConfigView {
  return {
    id: entry.installed.id,
    version: entry.installed.version,
    settings: entry.manifest.settings ?? {},
    values: maskValues(entry, merged),
    configuredSecrets: configuredSecrets(entry, merged),
  };
}

/** Presence bits for secret fields: the merged read holds stored secret values, and only their
 * field ids may cross the wire. */
function configuredSecrets(
  entry: InstalledLinkCodePluginEntry,
  merged: Record<string, PluginConfigValue>,
): string[] {
  const settings = entry.manifest.settings;
  if (settings === undefined) return [];
  const ids: string[] = [];
  const settingEntries = Object.entries(settings);
  for (let i = 0, len = settingEntries.length; i < len; i++) {
    const [fieldId, field] = settingEntries[i];
    if (field.secret === true && fieldId in merged) ids.push(fieldId);
  }
  return ids;
}

function maskValues(
  entry: InstalledLinkCodePluginEntry,
  merged: Record<string, PluginConfigValue>,
): Record<string, PluginConfigValue> {
  const settings = entry.manifest.settings;
  if (settings === undefined) return {};
  const masked: Record<string, PluginConfigValue> = {};
  const settingEntries = Object.entries(settings);
  for (let i = 0, len = settingEntries.length; i < len; i++) {
    const [fieldId, field] = settingEntries[i];
    if (field.secret) continue;
    if (fieldId in merged) masked[fieldId] = merged[fieldId];
  }
  return masked;
}
