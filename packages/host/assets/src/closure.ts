/**
 * npm-closure assets (CODE-219): an asset that is a whole npm dependency tree the daemon loads
 * IN-PROCESS (pi), not a spawnable binary. The closure is resolved at BUILD time from
 * pnpm-lock.yaml into a static manifest — the runtime downloads exact tgz bytes and lays them
 * out; it never resolves versions, never runs install scripts, never mutates an installed tree.
 */

/** One package of the closure: exact bytes (lockfile SRI) at a fixed layout position. */
export interface ClosurePackage {
  name: string;
  version: string;
  /** SRI digest from pnpm-lock.yaml — the build-time trust root. */
  integrity: string;
  /** Install location relative to the version dir, e.g. `node_modules/@scope/name`. */
  path: string;
  /** Platform constraints from the lockfile (`os`/`cpu`); absent = every platform. */
  os?: readonly string[];
  cpu?: readonly string[];
}

/** A generated, committed closure manifest (see `scripts/generate-pi-closure.mts`). */
export interface NpmClosure {
  /** The closure root's exact version — must equal the asset's wanted pin. */
  version: string;
  /** Entry module relative to the version dir, the adapter's in-process import target. */
  entry: string;
  packages: readonly ClosurePackage[];
}

/** The packages this host actually installs — platform-constrained ones are filtered here. */
export function closurePackagesForHost(
  closure: NpmClosure,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): ClosurePackage[] {
  return closure.packages.filter(
    (pkg) => (!pkg.os || pkg.os.includes(platform)) && (!pkg.cpu || pkg.cpu.includes(arch)),
  );
}

/**
 * Registry tarball sources, primary first. The mirror is a plain fallback: `integrity` pins the
 * exact bytes, so extra sources never change the trust model. pi's ecosystem is MIT — the
 * "registry only, never mirror" constraint applies solely to claude's proprietary packages.
 */
export const CLOSURE_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
] as const;

export function npmTarballUrls(
  name: string,
  version: string,
  registries: readonly string[] = CLOSURE_REGISTRIES,
): string[] {
  const basename = name[0] === '@' ? name.split('/', 2)[1] : name;
  const tail = `${name}/-/${basename}-${version}.tgz`;
  return registries.map((registry) => `${registry.replace(/\/$/, '')}/${tail}`);
}
