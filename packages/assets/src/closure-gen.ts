import { rcompare } from 'semver';
import { parse } from 'yaml';
import type { ClosurePackage, NpmClosure } from './closure';

/**
 * Build-time generator core: extract one package's full runtime closure from pnpm-lock.yaml v9
 * into a static {@link NpmClosure} manifest. Deliberately NOT exported from the package entry —
 * it is dev tooling (see `scripts/generate-pi-closure.mts` and the drift test); the daemon
 * bundle must never pull in a yaml parser or lockfile knowledge.
 *
 * Resolution already happened in pnpm: this walks the `snapshots` graph (dependencies +
 * optionalDependencies) and reads `packages` for integrity/os/cpu. Layout follows node's
 * resolution rules: the highest version of each name is hoisted to the root `node_modules`,
 * and a dependent needing another version gets a nested copy under its own directory —
 * skipped when the nearest ancestor already provides that exact version, which also
 * terminates dependency cycles.
 */
export interface GenerateClosureOptions {
  lockfileText: string;
  /** The closure root, e.g. `@earendil-works/pi-coding-agent`. */
  rootPackage: string;
  /** Entry module relative to the version dir, baked into the manifest. */
  entry: string;
}

interface LockfileSnapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface LockfilePackage {
  resolution?: { integrity?: string };
  os?: string[];
  cpu?: string[];
}

interface Lockfile {
  lockfileVersion?: string;
  packages?: Record<string, LockfilePackage>;
  snapshots?: Record<string, LockfileSnapshot>;
}

interface ClosureNode {
  name: string;
  version: string;
  integrity: string;
  os?: string[];
  cpu?: string[];
  /** Dependency name → child snapshot key. */
  deps: ReadonlyMap<string, string>;
}

/** Split a snapshot key `name@version(peers…)` — the name may itself be scoped (`@scope/…`). */
function parseSnapshotKey(key: string): { name: string; version: string } {
  const at = key.indexOf('@', 1);
  if (at === -1) throw new Error(`unparseable snapshot key: ${key}`);
  const name = key.slice(0, at);
  const rest = key.slice(at + 1);
  const paren = rest.indexOf('(');
  return { name, version: paren === -1 ? rest : rest.slice(0, paren) };
}

/** BFS the snapshot graph from `rootKey`, materializing one node per snapshot key. */
function collectNodes(lockfile: Lockfile, rootKey: string): Map<string, ClosureNode> {
  const snapshots = lockfile.snapshots ?? {};
  const packages = lockfile.packages ?? {};
  const nodes = new Map<string, ClosureNode>();
  const queue = [rootKey];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (nodes.has(key)) continue;
    const { name, version } = parseSnapshotKey(key);
    if (version.includes(':')) {
      throw new Error(`non-registry dependency in closure: ${key}`);
    }
    const meta = packages[`${name}@${version}`];
    const integrity = meta?.resolution?.integrity;
    if (!integrity) throw new Error(`no integrity recorded for ${name}@${version}`);
    const snapshot = snapshots[key] ?? {};
    const deps = new Map<string, string>();
    for (const source of [snapshot.dependencies, snapshot.optionalDependencies]) {
      for (const [depName, depVersion] of Object.entries(source ?? {})) {
        const childKey = `${depName}@${depVersion}`;
        deps.set(depName, childKey);
        queue.push(childKey);
      }
    }
    nodes.set(key, {
      name,
      version,
      integrity,
      ...(meta.os && { os: meta.os }),
      ...(meta.cpu && { cpu: meta.cpu }),
      deps,
    });
  }
  return nodes;
}

export function generateClosure(options: GenerateClosureOptions): NpmClosure {
  const lockfile = parse(options.lockfileText) as Lockfile;
  if (lockfile.lockfileVersion !== '9.0') {
    throw new Error(
      `pnpm-lock.yaml is v${lockfile.lockfileVersion}; the closure walker only knows v9.0 — re-verify the format before bumping this guard`,
    );
  }

  const rootKeys = Object.keys(lockfile.snapshots ?? {}).filter((key) =>
    key.startsWith(`${options.rootPackage}@`),
  );
  if (rootKeys.length !== 1) {
    throw new Error(
      `expected exactly one lockfile snapshot for ${options.rootPackage}, found ${rootKeys.length}`,
    );
  }
  const nodes = collectNodes(lockfile, rootKeys[0]);

  // Hoist the highest version of each name to the root; other versions nest under dependents.
  const hoisted = new Map<string, string>();
  for (const node of nodes.values()) {
    const current = hoisted.get(node.name);
    if (!current || rcompare(node.version, current) < 0) hoisted.set(node.name, node.version);
  }

  // path → package; two claims on one path must agree on the version (same tarball bytes).
  const placements = new Map<string, ClosurePackage>();
  function place(node: ClosureNode, path: string, provided: ReadonlyMap<string, string>): void {
    const existing = placements.get(path);
    if (existing) {
      if (existing.version !== node.version) {
        throw new Error(
          `layout collision at ${path}: ${existing.version} vs ${node.version} (peer-variant snapshots disagree)`,
        );
      }
      return;
    }
    placements.set(path, {
      name: node.name,
      version: node.version,
      integrity: node.integrity,
      path,
      ...(node.os && { os: node.os }),
      ...(node.cpu && { cpu: node.cpu }),
    });
    const scope = new Map(provided);
    for (const childKey of node.deps.values()) {
      const child = parseSnapshotKey(childKey);
      scope.set(child.name, child.version);
    }
    for (const childKey of node.deps.values()) {
      const child = nodes.get(childKey)!;
      // The root (or a nearer ancestor) already provides this exact version — node resolution
      // finds it by walking up, and skipping here is what terminates dependency cycles.
      if (provided.get(child.name) === child.version) continue;
      if (hoisted.get(child.name) === child.version && !provided.has(child.name)) continue;
      place(child, `${path}/node_modules/${child.name}`, scope);
    }
  }

  // Root pass: one node per hoisted name@version (peer-variants of the same version share
  // identical tarball bytes; their dep differences surface as nested placements above).
  const rootProvided = new Map(hoisted);
  for (const [name, version] of hoisted) {
    const node = [...nodes.values()].find(
      (candidate) => candidate.name === name && candidate.version === version,
    )!;
    place(node, `node_modules/${name}`, rootProvided);
  }

  return {
    version: parseSnapshotKey(rootKeys[0]).version,
    entry: options.entry,
    packages: [...placements.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
