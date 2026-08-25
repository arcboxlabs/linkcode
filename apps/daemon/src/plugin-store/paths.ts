import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { daemonStateDir } from '../paths';

const RE_PATH_SEP = /[/\\]/g;

/** Per-universe LinkCode plugin store root: `<state dir>/plugins`. A fake `$HOME` redirects it,
 *  the same property that isolates an E2E daemon from the release one. */
export function pluginsRoot(): string {
  return join(daemonStateDir(), 'plugins');
}

/** The central install registry: one `InstalledLinkCodePlugin` record per installed version. */
export function pluginRegistryPath(): string {
  return join(pluginsRoot(), 'registry.json');
}

/** Escapes a plugin id (`publisher/name`) into a stable two-level path; the id's `/` is the level. */
export function pluginPackageDir(pluginId: string, version: string): string {
  const segments = pluginId.split('/');
  const safe =
    segments.length === 2 ? segments : ['unmanaged', pluginId.replaceAll(RE_PATH_SEP, '_')];
  return join(pluginsRoot(), ...safe, version);
}

/** Staging and retired-package siblings share this prefix so a boot sweep can recognize both. */
export const PLUGIN_STAGING_PREFIX = '.tmp-';

/** Retired packages use `${PLUGIN_STAGING_PREFIX}${PLUGIN_RETIRED_INFIX}...`; a boot sweep may need
 * to restore them when a hard kill interrupts publishing. */
export const PLUGIN_RETIRED_INFIX = 'retired-';

/** Allocate staging beside the target for same-volume rename; create only the parent so failed
 * installs do not leave an empty version directory. */
export function makePluginTmpDir(pluginId: string, version: string): string {
  const parent = join(pluginPackageDir(pluginId, version), '..');
  mkdirSync(parent, { recursive: true });
  return join(parent, `${PLUGIN_STAGING_PREFIX}${process.pid}-${version}-${randomUUID()}`);
}
