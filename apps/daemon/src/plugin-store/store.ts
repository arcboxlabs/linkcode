import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { downloadVerified } from '@linkcode/assets';
import type {
  InstalledLinkCodePluginEntry,
  LinkCodePluginStore,
  PluginConfigPatch,
  PluginConfigValue,
} from '@linkcode/engine';
import { validatePluginConfigPatch } from '@linkcode/engine';
import type {
  InstalledLinkCodePlugin,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
  LinkCodePluginSettingField,
  ManagedAssetArtifact,
} from '@linkcode/schema';
import {
  InstalledLinkCodePluginSchema,
  isAllowedMarketplaceUrl,
  isValidPluginSettingValue,
  LinkCodePluginIdSchema,
  LinkCodePluginManifestReaderSchema,
} from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { extract as tarExtract } from 'tar';
import { loadPluginConfigValues, pluginSecretStore, savePluginConfigValues } from '../config';
import { logger } from '../logger';
import type { SecretStore, SecretVault } from '../secrets';
import {
  makePluginTmpDir,
  PLUGIN_RETIRED_INFIX,
  PLUGIN_STAGING_PREFIX,
  pluginPackageDir,
  pluginRegistryPath,
  pluginsRoot,
  pluginUninstallTombstonePath,
} from './paths';

/** Daemon-backed LinkCode plugin store: reads the install registry + on-disk manifests, splits
 * setting values between `config.json` (non-secret) and the vault `plugin` namespace (secret) per
 * each manifest's `secret` flag, and installs releases by downloading, SRI-verifying, extracting,
 * and atomically renaming into the package dir. */
export class DaemonLinkCodePluginStore implements LinkCodePluginStore {
  constructor(private readonly vault: SecretVault) {
    sweepStagingDirs();
    sweepUninstallTombstones(pluginSecretStore(this.vault));
  }

  list(): InstalledLinkCodePluginEntry[] {
    const entries: InstalledLinkCodePluginEntry[] = [];
    for (const record of currentRegistryRecords()) {
      const manifest = readManifest(record.path);
      if (manifest === undefined) continue;
      entries.push({ installed: record, manifest });
    }
    return entries;
  }

  get(pluginId: string): InstalledLinkCodePluginEntry | undefined {
    return this.list().find((entry) => entry.installed.id === pluginId);
  }

  getSettings(pluginId: string): Record<string, PluginConfigValue> {
    const manifest = this.get(pluginId)?.manifest;
    if (manifest?.settings === undefined) return {};
    const nonSecret = loadPluginConfigValues(pluginId);
    const secrets = pluginSecretStore(this.vault);
    const merged: Record<string, PluginConfigValue> = {};
    for (const [fieldId, field] of Object.entries(manifest.settings)) {
      if (field.secret) {
        // No default folding for secrets: a secret's default would be a plaintext credential in
        // the manifest, injected into env while the masked read hides where it came from.
        const stored = secrets.get(`${pluginId}/${fieldId}`);
        if (stored !== null) merged[fieldId] = stored;
      } else if (fieldId in nonSecret) {
        merged[fieldId] = nonSecret[fieldId];
      } else if (field.default !== undefined) {
        merged[fieldId] = field.default;
      }
    }
    return merged;
  }

  setSettings(pluginId: string, patch: PluginConfigPatch): Promise<void> {
    const manifest = this.get(pluginId)?.manifest;
    if (manifest?.settings === undefined) {
      throw new Error(`Plugin ${pluginId} declares no settings`);
    }
    const settings = manifest.settings;
    // The wire only guarantees primitive values — validate against the manifest before persisting.
    // Throws PluginConfigValidationError, which the engine maps to `invalid_request`.
    validatePluginConfigPatch(settings, this.getSettings(pluginId), patch);
    const secrets = pluginSecretStore(this.vault);
    const previousNonSecret = loadPluginConfigValues(pluginId);
    let nextNonSecret = { ...previousNonSecret };
    const secretPatch = new Map<string, string | undefined>();

    if (patch.remove) {
      for (const fieldId of patch.remove) {
        if (!(fieldId in settings)) continue;
        const field = settings[fieldId];
        if (field.secret) secretPatch.set(`${pluginId}/${fieldId}`, undefined);
        else {
          const { [fieldId]: _removed, ...rest } = nextNonSecret;
          nextNonSecret = rest;
        }
      }
    }
    if (patch.set) {
      for (const [fieldId, value] of Object.entries(patch.set)) {
        if (!(fieldId in settings)) continue;
        const field = settings[fieldId];
        if (field.secret) secretPatch.set(`${pluginId}/${fieldId}`, String(value));
        else nextNonSecret[fieldId] = value;
      }
    }
    const previousSecrets = new Map(
      [...secretPatch.keys()].map((key) => [key, secrets.get(key)] as const),
    );

    // There is no cross-file transaction between config.json and the vault. Commit config first;
    // if the vault write then fails, restore config and every affected secret to their snapshots.
    savePluginConfigValues(pluginId, nextNonSecret);
    try {
      applySecretPatch(secrets, secretPatch);
    } catch (error) {
      try {
        applySecretPatch(secrets, previousSecrets);
      } catch (rollbackError) {
        logger.warn(
          { error: rollbackError, pluginId, operation: 'plugin.settings.rollback-vault' },
          'Failed to restore plugin secrets after a settings write failure',
        );
      }
      try {
        savePluginConfigValues(pluginId, previousNonSecret);
      } catch (rollbackError) {
        logger.warn(
          { error: rollbackError, pluginId, operation: 'plugin.settings.rollback-config' },
          'Failed to restore plugin config after a settings write failure',
        );
      }
      throw error;
    }
    return Promise.resolve();
  }

  /** Serializes installs and uninstalls per plugin id; a concurrent second mutation would
   * otherwise publish to / delete the same package dir and leave the registry inconsistent. */
  private readonly installChains = new Map<string, Promise<unknown>>();

  install(
    release: LinkCodePluginRelease,
    marketplaceId: string,
  ): Promise<InstalledLinkCodePluginEntry> {
    return this.serialize(release.manifest.id, () =>
      installExclusive(release, marketplaceId, pluginSecretStore(this.vault)),
    );
  }

  uninstall(pluginId: string): Promise<void> {
    return this.serialize(pluginId, () => {
      const records = readRegistryStrict();
      const matches = records.filter((entry) => entry.id === pluginId);
      const tombstone = pluginUninstallTombstonePath(pluginId);
      if (matches.length > 0) {
        // Retire each live package before committing so a failed registry write can restore them,
        // exactly as install's publish does; a mid-loop retire failure restores what already moved.
        const retired: Array<{
          record: InstalledLinkCodePlugin;
          retiredDir: string | undefined;
        }> = [];
        try {
          for (const record of matches) {
            retired.push({ record, retiredDir: retireForUninstall(record) });
          }
        } catch (error) {
          for (const { record, retiredDir } of retired) {
            if (retiredDir !== undefined) restorePluginPackage(retiredDir, record.path, pluginId);
          }
          throw error;
        }
        // Written before the registry commit so a crash on either side leaves a retryable cleanup;
        // the boot sweep discards it unread while the plugin is still registered.
        writeUninstallTombstone(tombstone, pluginId);
        try {
          writeRegistry(records.filter((entry) => entry.id !== pluginId));
        } catch (error) {
          for (const { record, retiredDir } of retired) {
            if (retiredDir !== undefined) restorePluginPackage(retiredDir, record.path, pluginId);
          }
          rmSync(tombstone, { force: true });
          throw error;
        }
        for (const { retiredDir } of retired) {
          if (retiredDir === undefined) continue;
          try {
            rmSync(retiredDir, { recursive: true, force: true });
          } catch (error) {
            logger.warn(
              { error, pluginId, path: retiredDir, operation: 'plugin.uninstall.gc-retired' },
              'Failed to remove the retired plugin package after uninstall',
            );
          }
        }
      } else {
        writeUninstallTombstone(tombstone, pluginId);
      }
      // The registry has already committed (or never held the plugin), so a cleanup failure must
      // not fail the uninstall — the tombstone retries it at the next boot.
      try {
        // Non-secret values are dropped by writing an empty block; secret values are pruned.
        savePluginConfigValues(pluginId, {});
        prunePluginSecrets(pluginSecretStore(this.vault), pluginId);
      } catch (error) {
        logger.error(
          { error, pluginId, operation: 'plugin.uninstall.cleanup' },
          'Plugin settings cleanup failed after uninstall; the cleanup marker retries it at boot',
        );
        return;
      }
      rmSync(tombstone, { force: true });
    });
  }

  private serialize<T>(pluginId: string, task: () => Promise<T> | T): Promise<T> {
    const run = (this.installChains.get(pluginId) ?? Promise.resolve())
      .catch(noop)
      .then(() => task());
    this.installChains.set(pluginId, run);
    const settle = (): void => {
      if (this.installChains.get(pluginId) === run) this.installChains.delete(pluginId);
    };
    void run.catch(noop).finally(settle);
    return run;
  }
}

async function installExclusive(
  release: LinkCodePluginRelease,
  marketplaceId: string,
  secrets: SecretStore,
): Promise<InstalledLinkCodePluginEntry> {
  const { manifest, artifact } = release;
  if (artifact.format !== 'tgz') {
    throw new Error(`Unsupported plugin archive format: ${artifact.format}`);
  }
  // Mirrors arrive absolutized against the index URL; keep only schemes the marketplace source
  // itself may use (https, plus loopback http for dev marketplaces).
  const downloadUrls = artifact.urls.filter((url) => isAllowedMarketplaceUrl(url));
  if (downloadUrls.length === 0) {
    throw new Error('Plugin release has no HTTPS (or loopback HTTP) download URL');
  }
  const previousRecords = readRegistryStrict().filter((entry) => entry.id === manifest.id);
  const targetDir = pluginPackageDir(manifest.id, manifest.version);
  const stagingDir = makePluginTmpDir(manifest.id, manifest.version);
  const tgzPath = join(stagingDir, 'package.tgz');
  const record: InstalledLinkCodePlugin = {
    id: manifest.id,
    version: manifest.version,
    marketplaceId,
    integrity: artifact.integrity,
    enabled: true,
    path: targetDir,
  };
  // A leftover uninstall marker means the registry had already dropped the id when that
  // uninstall's settings cleanup failed. Purge before this install re-registers the id, or the
  // boot sweep would discard the marker unread and the inherited values would survive.
  const tombstone = pluginUninstallTombstonePath(manifest.id);
  if (existsSync(tombstone)) {
    try {
      savePluginConfigValues(manifest.id, {});
      prunePluginSecrets(secrets, manifest.id);
      rmSync(tombstone, { force: true });
      logger.info(
        { pluginId: manifest.id, operation: 'plugin.install.purge-pending-uninstall' },
        'Purged settings left by a committed but unfinished uninstall',
      );
    } catch (error) {
      logger.warn(
        { error, pluginId: manifest.id, operation: 'plugin.install.purge-pending-uninstall' },
        'Failed to purge settings left by an unfinished uninstall; the marker stays for the boot sweep',
      );
    }
  }
  let installedManifest: LinkCodePluginManifest;
  let retiredDir: string | undefined;
  let published = false;
  mkdirSync(stagingDir, { recursive: true });
  try {
    const downloadArtifact: ManagedAssetArtifact = {
      urls: downloadUrls,
      integrity: artifact.integrity,
      size: artifact.size,
      format: 'tgz',
    };
    await downloadVerified(downloadArtifact, tgzPath, {});
    // Without `strict`, node-tar only warns when it rejects unsafe members, so a partial archive
    // whose manifest still matches could otherwise appear to install successfully.
    await tarExtract({ file: tgzPath, cwd: stagingDir, strip: 1, strict: true });
    const onDisk = readManifest(stagingDir);
    if (onDisk?.id !== manifest.id || onDisk.version !== manifest.version) {
      throw new Error(
        `Extracted manifest does not match release ${manifest.id}@${manifest.version}`,
      );
    }
    installedManifest = onDisk;
    mkdirSync(dirname(targetDir), { recursive: true });
    // Retire the live package before publishing so a failed rename can restore it without leaving
    // the registry pointed at a missing directory.
    retiredDir = retirePluginPackage(targetDir);
    renameSync(stagingDir, targetDir);
    published = true;
    // Publish before persisting so a failed registry write can roll the package back; a hard kill
    // between the two leaves only a harmless orphan/stale-integrity the next install reclaims.
    upsertRegistry(record);
  } catch (error) {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn(
        { error: cleanupError, path: stagingDir, operation: 'plugin.install.cleanup-staging' },
        'Failed to remove plugin staging after an install failure',
      );
    }
    if (published) rollbackPublishedPluginPackage(targetDir, retiredDir, manifest.id);
    else if (retiredDir !== undefined) restorePluginPackage(retiredDir, targetDir, manifest.id);
    throw new Error(
      `Failed to install plugin ${manifest.id}: ${extractErrorMessage(error) ?? 'unknown'}`,
      { cause: error },
    );
  }
  if (retiredDir !== undefined) {
    try {
      rmSync(retiredDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        { error, pluginId: manifest.id, path: retiredDir, operation: 'plugin.install.gc-retired' },
        'Failed to remove the retired plugin package after publishing',
      );
    }
  }
  // A plugin id has one active settings block and one wire identity, so keep exactly one installed
  // version. Remove stale package directories only after the new package and registry record exist.
  for (const previous of previousRecords) {
    if (previous.path === targetDir) continue;
    try {
      rmSync(previous.path, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        { error, pluginId: manifest.id, path: previous.path, operation: 'plugin.install.gc' },
        'Failed to remove stale plugin package',
      );
    }
  }
  // Reconcile stored settings against the new manifest only after the install commits; a failure
  // must not roll back a committed install, so it is logged and left for the next upgrade. The
  // tombstone path above runs before the commit, so a pending-uninstall purge can never coexist
  // with previous records here.
  if (previousRecords.length > 0) {
    try {
      reconcileSettingsForManifest(installedManifest, secrets);
    } catch (error) {
      logger.warn(
        { error, pluginId: manifest.id, operation: 'plugin.install.reconcile-settings' },
        'Failed to reconcile stored plugin settings after an upgrade',
      );
    }
  }
  logger.info(
    { pluginId: manifest.id, version: manifest.version, operation: 'plugin.install' },
    'Installed LinkCode plugin',
  );
  return { installed: record, manifest: installedManifest };
}

/** Delete incomplete staging dirs; retain unproven backups until their exact version is reinstalled. */
function sweepStagingDirs(): void {
  const root = pluginsRoot();
  const records = readRegistry();
  let swept = 0;
  let restored = 0;
  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name.startsWith(PLUGIN_STAGING_PREFIX)) {
        const isRetired = entry.name.startsWith(`${PLUGIN_STAGING_PREFIX}${PLUGIN_RETIRED_INFIX}`);
        if (isRetired) {
          const outcome = reconcileRetiredPackage(path, dir, records);
          if (outcome === 'restored') restored += 1;
          else if (outcome === 'swept') swept += 1;
          continue;
        }
        try {
          rmSync(path, { recursive: true, force: true });
          swept += 1;
        } catch (error) {
          logger.warn(
            { error, path, operation: 'plugin.staging.sweep' },
            'Failed to remove an orphaned plugin staging directory',
          );
        }
        continue;
      }
      // publisher/name/<version>: staging siblings live at depth 2, so stop descending there.
      if (depth < 2) walk(path, depth + 1);
    }
  };
  walk(root, 0);
  if (swept > 0 || restored > 0) {
    logger.info(
      { swept, restored, operation: 'plugin.staging.sweep' },
      'Reconciled orphaned plugin staging directories',
    );
  }
}

type RetiredPackageOutcome = 'retained' | 'restored' | 'swept';

function reconcileRetiredPackage(
  path: string,
  parentDir: string,
  records: readonly InstalledLinkCodePlugin[],
): RetiredPackageOutcome {
  const manifest = readManifest(path);
  if (manifest === undefined) {
    logger.warn(
      { path, operation: 'plugin.staging.retain' },
      'Keeping an unverifiable retired plugin package',
    );
    return 'retained';
  }

  const target = pluginPackageDir(manifest.id, manifest.version);
  const hasExactRecord = records.some(
    (record) =>
      record.id === manifest.id && record.version === manifest.version && record.path === target,
  );
  if (!hasExactRecord || dirname(target) !== parentDir) {
    logger.warn(
      { path, target, operation: 'plugin.staging.retain' },
      'Keeping a retired plugin package without an exact registry record',
    );
    return 'retained';
  }

  let targetStat: ReturnType<typeof lstatSync> | undefined;
  try {
    targetStat = lstatSync(target, { throwIfNoEntry: false });
  } catch (error) {
    logger.warn(
      { error, path, target, operation: 'plugin.staging.inspect' },
      'Keeping a retired plugin package because its target could not be inspected',
    );
    return 'retained';
  }

  if (targetStat === undefined) {
    try {
      renameSync(path, target);
      return 'restored';
    } catch (error) {
      logger.error(
        { error, path, target, operation: 'plugin.staging.restore' },
        'Failed to restore a retired plugin package; keeping the backup',
      );
      return 'retained';
    }
  }

  const published = targetStat.isDirectory() ? readManifest(target) : undefined;
  if (published?.id !== manifest.id || published.version !== manifest.version) {
    logger.warn(
      { path, target, operation: 'plugin.staging.retain' },
      'Keeping a retired plugin package because its target is occupied',
    );
    return 'retained';
  }

  try {
    rmSync(path, { recursive: true, force: true });
    return 'swept';
  } catch (error) {
    logger.warn(
      { error, path, operation: 'plugin.staging.sweep' },
      'Failed to remove a retired plugin package after a completed publish',
    );
    return 'retained';
  }
}

/** Move a live package aside so the publish can be undone; undefined when there was nothing there. */
function retirePluginPackage(targetDir: string): string | undefined {
  const retired = join(
    dirname(targetDir),
    `${PLUGIN_STAGING_PREFIX}${PLUGIN_RETIRED_INFIX}${process.pid}-${randomUUID()}`,
  );
  try {
    renameSync(targetDir, retired);
    return retired;
  } catch (error) {
    // ENOENT is the ordinary first-install case; anything else means the live package is still there
    // and the caller's own rename will fail, which the catch turns into a clean install failure.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(
        { error, path: targetDir, operation: 'plugin.install.retire' },
        'Could not move the existing plugin package aside',
      );
    }
    return undefined;
  }
}

/** Put a retired package back after a failed publish. Best-effort: the throw is already in flight. */
function restorePluginPackage(retiredDir: string, targetDir: string, pluginId: string): void {
  try {
    if (lstatSync(targetDir, { throwIfNoEntry: false }) !== undefined) {
      logger.error(
        { pluginId, path: targetDir, retiredDir, operation: 'plugin.install.restore' },
        'Cannot restore the previous plugin package because its target is occupied',
      );
      return;
    }
    renameSync(retiredDir, targetDir);
  } catch (error) {
    logger.error(
      { error, pluginId, path: targetDir, operation: 'plugin.install.restore' },
      'Failed to restore the previous plugin package after a failed install; it is left at the retired path',
    );
  }
}

/** Undo a package publish after registry persistence fails; the target is the package just staged. */
function rollbackPublishedPluginPackage(
  targetDir: string,
  retiredDir: string | undefined,
  pluginId: string,
): void {
  try {
    rmSync(targetDir, { recursive: true, force: true });
  } catch (error) {
    logger.error(
      {
        error,
        pluginId,
        path: targetDir,
        retiredDir,
        operation: 'plugin.install.rollback-publish',
      },
      'Failed to remove a published plugin after registry persistence failed',
    );
    return;
  }
  if (retiredDir !== undefined) restorePluginPackage(retiredDir, targetDir, pluginId);
}

/** Uninstall's retire is strict: a package that exists but cannot be moved aborts the mutation
 * before the registry is touched, instead of orphaning the live directory. */
function retireForUninstall(record: InstalledLinkCodePlugin): string | undefined {
  if (lstatSync(record.path, { throwIfNoEntry: false }) === undefined) return undefined;
  return nullthrow(
    retirePluginPackage(record.path),
    `Failed to retire the plugin package: ${record.path}`,
  );
}

/** Best-effort: a missing marker only means a mid-cleanup crash would not be retried at boot. */
function writeUninstallTombstone(path: string, pluginId: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ pluginId })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    logger.warn(
      { error, pluginId, path, operation: 'plugin.uninstall.tombstone' },
      'Failed to persist the uninstall cleanup marker',
    );
  }
}

/**
 * Retry settings cleanups whose uninstall committed but crashed or failed before config/vault were
 * pruned. A marker whose plugin is still registered belongs to an aborted uninstall and is
 * discarded. A corrupt registry blocks the whole sweep: reading it degraded as "not registered"
 * would wipe the settings of plugins that are, in fact, still installed.
 */
function sweepUninstallTombstones(secrets: SecretStore): void {
  let names: string[];
  try {
    names = readdirSync(pluginsRoot());
  } catch {
    return;
  }
  const markers = names.filter((name) => name.startsWith('.uninstall-') && name.endsWith('.json'));
  if (markers.length === 0) return;
  let registered: ReadonlySet<string>;
  try {
    registered = new Set(readRegistryStrict().map((record) => record.id));
  } catch (error) {
    logger.warn(
      { error, operation: 'plugin.uninstall.sweep' },
      'Skipping uninstall cleanup retries while the plugin registry is unreadable',
    );
    return;
  }
  for (const name of markers) {
    const path = join(pluginsRoot(), name);
    let pluginId: string;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      pluginId = LinkCodePluginIdSchema.parse((parsed as { pluginId?: unknown }).pluginId);
    } catch (error) {
      logger.warn(
        { error, path, operation: 'plugin.uninstall.sweep' },
        'Keeping an unreadable uninstall cleanup marker',
      );
      continue;
    }
    if (registered.has(pluginId)) {
      rmSync(path, { force: true });
      continue;
    }
    try {
      savePluginConfigValues(pluginId, {});
      prunePluginSecrets(secrets, pluginId);
      rmSync(path, { force: true });
      logger.info(
        { pluginId, operation: 'plugin.uninstall.sweep' },
        'Retried a plugin settings cleanup after an interrupted uninstall',
      );
    } catch (error) {
      logger.warn(
        { error, pluginId, operation: 'plugin.uninstall.sweep' },
        'Plugin settings cleanup retry failed; keeping the marker',
      );
    }
  }
}

/**
 * Re-key stored setting values after an upgrade. Config-side values whose field vanished or no
 * longer validates are dropped; a non-secret → secret flip moves the value into the vault, or it
 * would sit in plaintext config.json. The reverse flip drops from the vault instead of migrating
 * out — maskValues only honors the current manifest, so a migrated value would come back unmasked.
 */
function reconcileSettingsForManifest(
  manifest: LinkCodePluginManifest,
  secrets: SecretStore,
): void {
  // Partial: arbitrary-key access can miss, and the honest initializer type keeps
  // no-unnecessary-condition from reading the undefined checks as dead.
  const declared: Partial<Record<string, LinkCodePluginSettingField>> = manifest.settings ?? {};
  const next: Record<string, PluginConfigValue> = {};
  const secretPatch = new Map<string, string | undefined>();
  for (const [fieldId, value] of Object.entries(loadPluginConfigValues(manifest.id))) {
    const field = declared[fieldId];
    if (field === undefined || !isValidPluginSettingValue(field, value)) continue;
    if (field.secret) secretPatch.set(`${manifest.id}/${fieldId}`, String(value));
    else next[fieldId] = value;
  }
  const prefix = `${manifest.id}/`;
  for (const key of secrets.keys()) {
    // A vanished field goes, obviously. A secret→public flip drops too, by the same logic that
    // protects the opposite direction: migrating the old secret into plaintext config.json would
    // serve it unmasked on the next masked read — re-entry costs the user one field. A still
    // secret field keeps its raw stringified vault value untouched.
    if (
      key.startsWith(prefix) &&
      (declared[key.slice(prefix.length)]?.secret !== true || secrets.get(key) === null)
    ) {
      secretPatch.set(key, undefined);
    }
  }
  // Vault before config: a failed config write then leaves an inert duplicate (re-reconciled on
  // the next upgrade) rather than a value lost between the two stores.
  applySecretPatch(secrets, secretPatch);
  savePluginConfigValues(manifest.id, next);
}

function applySecretPatch(
  secrets: SecretStore,
  patch: ReadonlyMap<string, string | null | undefined>,
): void {
  for (const [key, value] of patch) {
    if (value === null || value === undefined) secrets.delete(key);
    else secrets.set(key, value);
  }
}

function readRegistry(): InstalledLinkCodePlugin[] {
  const path = pluginRegistryPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, operation: 'plugin.registry' }, 'Malformed plugin registry; starting empty');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: InstalledLinkCodePlugin[] = [];
  for (const value of parsed) {
    const result = InstalledLinkCodePluginSchema.safeParse(value);
    if (!result.success || !hasExpectedPackagePath(result.data)) {
      logger.warn({ operation: 'plugin.registry' }, 'Dropping invalid plugin install record');
    } else {
      records.push(result.data);
    }
  }
  return records;
}

/**
 * The registry read mutations must use. Only `ENOENT` means a first-run empty registry: any other
 * read error, malformed JSON, or invalid record fails closed, because a degraded read that
 * participates in the next `writeRegistry` would silently drop every other installation record.
 */
function readRegistryStrict(): InstalledLinkCodePlugin[] {
  const path = pluginRegistryPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Plugin registry is not a JSON array');
  return parsed.map((value: unknown, index) => {
    const result = InstalledLinkCodePluginSchema.safeParse(value);
    if (!result.success || !hasExpectedPackagePath(result.data)) {
      throw new Error(`Invalid plugin install record at index ${index}`, {
        cause: result.success ? undefined : result.error,
      });
    }
    return result.data;
  });
}

/** A record may only name its derived package dir; a corrupted path must never drive a removal. */
function hasExpectedPackagePath(record: InstalledLinkCodePlugin): boolean {
  return record.path === pluginPackageDir(record.id, record.version);
}

function currentRegistryRecords(): InstalledLinkCodePlugin[] {
  const latestById = new Map<string, InstalledLinkCodePlugin>();
  for (const record of readRegistry()) latestById.set(record.id, record);
  // Old builds could write duplicate versions. The newest registry entry wins for reads, while the
  // next successful install or uninstall compacts the registry and removes every stale package dir.
  return [...latestById.values()];
}

function upsertRegistry(record: InstalledLinkCodePlugin): void {
  const next = readRegistryStrict().filter((entry) => entry.id !== record.id);
  next.push(record);
  writeRegistry(next);
}

function writeRegistry(records: InstalledLinkCodePlugin[]): void {
  const path = pluginRegistryPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.registry.${process.pid}.${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(tmp, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8' });
      chmodSync(tmp, 0o600);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function readManifest(packageDir: string): LinkCodePluginManifest | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(packageDir, 'manifest.json'), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, packageDir, operation: 'plugin.manifest' }, 'Malformed plugin manifest');
    return undefined;
  }
  const result = LinkCodePluginManifestReaderSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ packageDir, operation: 'plugin.manifest' }, 'Dropping invalid plugin manifest');
    return undefined;
  }
  return result.data;
}

function prunePluginSecrets(secrets: SecretStore, pluginId: string): void {
  // Prune by `pluginId/`; `/` is forbidden in ids, while dots are legal and would match siblings.
  // Do not infer orphans from manifests because unreadable survivors must keep their secrets.
  const prefix = `${pluginId}/`;
  const surviving = new Map<string, string>();
  for (const key of secrets.keys()) {
    if (key.startsWith(prefix)) continue;
    const value = secrets.get(key);
    if (value !== null) surviving.set(key, value);
  }
  secrets.replaceAll(surviving);
}
