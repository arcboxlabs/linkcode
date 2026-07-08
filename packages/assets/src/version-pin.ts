/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { VersionPolicy } from './catalog';

/**
 * Reads the versions the installed SDKs pin their CLI binaries to. Undefined always means
 * "cannot pin" — the SDK is absent or the pin is not exact — and callers must then leave the
 * asset alone (no install, no GC of what is already on disk). Package dirs are located along
 * the module's node_modules chain instead of `require.resolve`: the SDKs' `exports` maps
 * reject bare CJS resolution outright.
 */

interface PackageManifest {
  version?: string;
  dependencies?: Record<string, string>;
}

/** A pair install must target an exact version — any range means the manifest is not a pin. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-\S+)?$/;

export function installedPackageDir(pkg: string, from?: string): string | undefined {
  const paths = createRequire(from ?? import.meta.url).resolve.paths(pkg) ?? [];
  return paths.map((dir) => join(dir, pkg)).find((dir) => existsSync(join(dir, 'package.json')));
}

function readManifest(pkg: string, from?: string): PackageManifest | undefined {
  const dir = installedPackageDir(pkg, from);
  if (!dir) return undefined;
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return undefined;
  }
}

function exact(version: string | undefined): string | undefined {
  return version && EXACT_VERSION.test(version) ? version : undefined;
}

/** @param from test seam — resolve node_modules relative to this file instead of this module. */
export function wantedVersion(policy: VersionPolicy, from?: string): string | undefined {
  switch (policy.kind) {
    case 'pinned':
      return policy.version;
    case 'sdk-version':
      return exact(readManifest(policy.package, from)?.version);
    case 'sdk-dependency':
      return exact(readManifest(policy.package, from)?.dependencies?.[policy.dependency]);
    // no default
  }
}
