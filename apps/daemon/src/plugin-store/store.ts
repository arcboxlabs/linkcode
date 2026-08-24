import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
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
import type {
  InstalledLinkCodePlugin,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
  ManagedAssetArtifact,
} from '@linkcode/schema';
import { InstalledLinkCodePluginSchema, LinkCodePluginManifestSchema } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { extract as tarExtract } from 'tar';
import { loadPluginConfigValues, pluginSecretStore, savePluginConfigValues } from '../config';
import { logger } from '../logger';
import type { SecretStore, SecretVault } from '../secrets';
import { makePluginTmpDir, pluginPackageDir, pluginRegistryPath } from './paths';

/** Daemon-backed LinkCode plugin store: reads the install registry + on-disk manifests, splits
 * setting values between `config.json` (non-secret) and the vault `plugin` namespace (secret) per
 * each manifest's `secret` flag, and installs releases by downloading, SRI-verifying, extracting,
 * and atomically renaming into the package dir. */
export class DaemonLinkCodePluginStore implements LinkCodePluginStore {
  constructor(private readonly vault: SecretVault) {}

  list(): InstalledLinkCodePluginEntry[] {
    const entries: InstalledLinkCodePluginEntry[] = [];
    for (const record of readRegistry()) {
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
        const stored = secrets.get(`${pluginId}.${fieldId}`);
        if (stored !== null) merged[fieldId] = stored;
      } else if (fieldId in nonSecret) {
        merged[fieldId] = nonSecret[fieldId];
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
    const secrets = pluginSecretStore(this.vault);
    const nonSecret = loadPluginConfigValues(pluginId);

    if (patch.remove) {
      for (const fieldId of patch.remove) {
        const field = settings[fieldId];
        if (field === undefined) continue;
        if (field.secret) secrets.delete(`${pluginId}.${fieldId}`);
        else delete nonSecret[fieldId];
      }
    }
    if (patch.set) {
      for (const [fieldId, value] of Object.entries(patch.set)) {
        const field = settings[fieldId];
        if (field === undefined) continue;
        if (field.secret) secrets.set(`${pluginId}.${fieldId}`, String(value));
        else nonSecret[fieldId] = value;
      }
    }
    savePluginConfigValues(pluginId, nonSecret);
    return Promise.resolve();
  }

  async install(
    release: LinkCodePluginRelease,
    marketplaceId: string,
  ): Promise<InstalledLinkCodePluginEntry> {
    const { manifest, artifact } = release;
    if (artifact.format !== 'tgz') {
      throw new Error(`Unsupported plugin archive format: ${artifact.format}`);
    }
    const httpsUrls = artifact.urls.filter((url): url is string => typeof url === 'string');
    if (httpsUrls.length === 0) {
      throw new Error('Plugin release has no HTTPS download URL');
    }
    const targetDir = pluginPackageDir(manifest.id, manifest.version);
    const stagingDir = makePluginTmpDir(manifest.id, manifest.version);
    const tgzPath = join(stagingDir, 'package.tgz');
    mkdirSync(stagingDir, { recursive: true });
    try {
      const downloadArtifact: ManagedAssetArtifact = {
        urls: httpsUrls,
        integrity: artifact.integrity,
        size: artifact.size,
        format: 'tgz',
      };
      await downloadVerified(downloadArtifact, tgzPath, {});
      await tarExtract({ file: tgzPath, cwd: stagingDir, strip: 1 });
      const onDisk = readManifest(stagingDir);
      if (onDisk?.id !== manifest.id || onDisk?.version !== manifest.version) {
        throw new Error(
          `Extracted manifest does not match release ${manifest.id}@${manifest.version}`,
        );
      }
      rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(dirname(targetDir), { recursive: true });
      renameSync(stagingDir, targetDir);
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw new Error(
        `Failed to install plugin ${manifest.id}: ${extractErrorMessage(error) ?? 'unknown'}`,
        { cause: error },
      );
    }
    const record: InstalledLinkCodePlugin = {
      id: manifest.id,
      version: manifest.version,
      marketplaceId,
      integrity: artifact.integrity,
      enabled: true,
      path: targetDir,
    };
    upsertRegistry(record);
    logger.info(
      { pluginId: manifest.id, version: manifest.version, operation: 'plugin.install' },
      'Installed LinkCode plugin',
    );
    return { installed: record, manifest };
  }

  uninstall(pluginId: string): Promise<void> {
    const record = readRegistry().find((entry) => entry.id === pluginId);
    if (record) {
      rmSync(record.path, { recursive: true, force: true });
      writeRegistry(readRegistry().filter((entry) => entry.id !== pluginId));
    }
    // Non-secret values are dropped by writing an empty block; secret values are pruned below.
    savePluginConfigValues(pluginId, {});
    prunePluginSecrets(pluginSecretStore(this.vault), pluginId);
    return Promise.resolve();
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
    if (result.success) records.push(result.data);
    else logger.warn({ operation: 'plugin.registry' }, 'Dropping invalid plugin install record');
  }
  return records;
}

function upsertRegistry(record: InstalledLinkCodePlugin): void {
  const next = readRegistry().filter(
    (entry) => entry.id !== record.id || entry.version !== record.version,
  );
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
  const result = LinkCodePluginManifestSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ packageDir, operation: 'plugin.manifest' }, 'Dropping invalid plugin manifest');
    return undefined;
  }
  return result.data;
}

function prunePluginSecrets(secrets: SecretStore, pluginId: string): void {
  // replaceAll on the `plugin` namespace keeps every OTHER plugin's secrets and drops this one's,
  // in a single write — the same prune-on-delete property the vault hands other namespaces.
  const surviving = new Map<string, string>();
  for (const entry of readRegistry()) {
    if (entry.id === pluginId) continue;
    for (const fieldId of secretFieldIds(entry)) {
      const value = secrets.get(`${entry.id}.${fieldId}`);
      if (value !== null) surviving.set(`${entry.id}.${fieldId}`, value);
    }
  }
  secrets.replaceAll(surviving);
}

function secretFieldIds(record: InstalledLinkCodePlugin): string[] {
  const manifest = readManifest(record.path);
  if (manifest?.settings === undefined) return [];
  const ids: string[] = [];
  for (const [fieldId, field] of Object.entries(manifest.settings)) {
    if (field.secret) ids.push(fieldId);
  }
  return ids;
}
