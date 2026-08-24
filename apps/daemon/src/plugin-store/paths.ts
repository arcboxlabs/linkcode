import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { linkcodeStateDirName } from '@linkcode/schema';
import { resolveProductChannel } from '@linkcode/schema/product';
import { daemonChannel, daemonProfile } from '../paths';

const RE_PATH_SEP = /[/\\]/g;

/** Per-universe LinkCode plugin store root: `<state dir>/plugins`. A fake `$HOME` redirects it,
 *  the same property that isolates an E2E daemon from the release one. */
export function pluginsRoot(): string {
  const channel = daemonChannel();
  const profile = daemonProfile();
  const stateDir = join(homedir(), linkcodeStateDirName(channel, profile));
  return join(stateDir, 'plugins');
}

/** The central install registry: one `InstalledLinkCodePlugin` record per installed version. */
export function pluginRegistryPath(): string {
  return join(pluginsRoot(), 'registry.json');
}

/** Escapes a plugin id (`publisher/name`) into a stable two-level path; the id's `/` is the level. */
export function pluginPackageDir(pluginId: string, version: string): string {
  const segments = pluginId.split('/');
  const safe = segments.length === 2 ? segments : ['unmanaged', pluginId.replace(RE_PATH_SEP, '_')];
  return join(pluginsRoot(), ...safe, version);
}

/** Unique staging dir beside the package dir, so concurrent installs publish through one same-volume
 * `rename` without sharing a partially extracted archive. */
export function makePluginTmpDir(pluginId: string, version: string): string {
  const dir = pluginPackageDir(pluginId, version);
  const parent = join(dir, '..');
  mkdirSync(dir, { recursive: true });
  return join(parent, `.tmp-${process.pid}-${version}-${randomUUID()}`);
}

/** Resolve product channel for callers that must not reach into the paths module's side effects. */
export function resolvedChannel(): ReturnType<typeof resolveProductChannel> {
  return resolveProductChannel(process.env.LINKCODE_CHANNEL, process.env.LINKCODE_BUILD_CHANNEL);
}
