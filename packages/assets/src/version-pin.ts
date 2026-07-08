/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { valid } from 'semver';
import type { VersionPolicy } from './catalog';

/**
 * Reads the versions the installed carrier packages pin their CLI binaries to (claude: the
 * agent SDK; codex: the `@openai/codex` meta package; opencode: its SDK). Undefined always
 * means "cannot pin" — the package is absent or its version is not exact — and callers must
 * then leave the asset alone (no install, no GC of what is already on disk). Package dirs are
 * located along the module's node_modules chain instead of `require.resolve`: the SDKs'
 * `exports` maps reject bare CJS resolution outright.
 */

interface PackageManifest {
  version?: string;
}

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

/** A pair install must target an exact version — a range is not a valid semver version. */
function exact(version: string | undefined): string | undefined {
  return version && valid(version) !== null ? version : undefined;
}

/** @param from test seam — resolve node_modules relative to this file instead of this module. */
export function wantedVersion(policy: VersionPolicy, from?: string): string | undefined {
  switch (policy.kind) {
    case 'pinned':
      return policy.version;
    case 'sdk-version':
      return exact(readManifest(policy.package, from)?.version);
    // no default
  }
}
