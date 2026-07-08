#!/usr/bin/env node
/**
 * Stage the vendored agent CLI binaries where electron-builder's
 * `extraResources: agent-bin/${arch}` (electron-builder.yml) picks them up.
 *
 * The binaries ship OUTSIDE the asar: an asar path is readable only through Electron's
 * patched APIs, not by the OS (spawn/exec), and per-target extraction is the only way to
 * package an arch the build host didn't install (npm optionalDependencies install the host
 * platform package only — relying on node_modules here would silently ship a broken arch).
 *
 * Each binary is downloaded from the npm registry at the exact version the bundled SDK pins
 * (SDK and CLI are released in lockstep and speak a private, unversioned stdio protocol —
 * the pair must never drift), integrity-checked against the registry's sha512, and staged to
 * `agent-bin/<arch>/<agent-kind>/<binary>`.
 *
 *   node scripts/stage-agent-runtimes.mts          # host arch (local `package`)
 *   node scripts/stage-agent-runtimes.mts --all    # host + cross arch (CI)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

/** The non-native arch each release platform also ships (matches stage-sidecar.mts). */
const CROSS_ARCH: Partial<Record<NodeJS.Platform, NodeJS.Architecture>> = {
  darwin: 'x64',
  win32: 'arm64',
  linux: 'arm64',
};

const desktopDir = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

interface AgentRuntime {
  kind: string;
  /** npm package carrying the binary for a platform/arch, e.g. `@anthropic-ai/claude-agent-sdk-darwin-arm64`. */
  platformPackage: (platform: string, arch: string) => string;
  /** Path of the binary inside the platform package (tarballs prefix members with `package/`). */
  binaryPath: (platform: string) => string;
  /** The SDK package whose installed version pins the binary version. */
  versionFrom: string;
}

const RUNTIMES: AgentRuntime[] = [
  {
    kind: 'claude-code',
    // Linux artifacts are glibc (AppImage/deb); the SDK's musl variant is not shipped.
    platformPackage: (platform, arch) => `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`,
    binaryPath: (platform) => (platform === 'win32' ? 'claude.exe' : 'claude'),
    versionFrom: '@anthropic-ai/claude-agent-sdk',
  },
];

function pinnedVersion(sdkPackage: string): string {
  // The SDKs' `exports` maps don't expose package.json; walk up from the resolved entry to the
  // package root instead.
  let dir = dirname(require.resolve(sdkPackage));
  for (;;) {
    let manifest: { name?: string; version: string } | undefined;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      /* no manifest at this level */
    }
    if (manifest?.name === sdkPackage) return manifest.version;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package root of ${sdkPackage} not found`);
    dir = parent;
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Download `pkg@version` from the npm registry and return the verified tarball path. */
async function downloadTarball(pkg: string, version: string, dir: string): Promise<string> {
  const packument = await fetchJson(`https://registry.npmjs.org/${pkg}`);
  const versions = packument.versions as Record<
    string,
    { dist: { tarball: string; integrity: string } } | undefined
  >;
  const dist = versions[version]?.dist;
  if (!dist) throw new Error(`${pkg}@${version} not found in registry`);
  const res = await fetch(dist.tarball);
  if (!res.ok) throw new Error(`GET ${dist.tarball} -> ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const [algo, expected] = dist.integrity.split('-', 2);
  const actual = createHash(algo).update(bytes).digest('base64');
  if (actual !== expected) throw new Error(`${pkg}@${version}: integrity mismatch (${algo})`);
  const file = join(dir, `${pkg.replaceAll('/', '-')}.tgz`);
  writeFileSync(file, bytes);
  return file;
}

async function stage(runtime: AgentRuntime, arch: string): Promise<void> {
  const version = pinnedVersion(runtime.versionFrom);
  const binary = runtime.binaryPath(process.platform);
  const destDir = join(desktopDir, 'agent-bin', arch, runtime.kind);
  const stamp = join(destDir, '.version');
  try {
    if (readFileSync(stamp, 'utf8') === version) {
      console.log(`agent-bin/${arch}/${runtime.kind} already at ${version}`);
      return;
    }
  } catch {
    /* not staged yet */
  }

  const pkg = runtime.platformPackage(process.platform, arch);
  const work = mkdtempSync(join(tmpdir(), 'agent-runtime-'));
  try {
    const tarball = await downloadTarball(pkg, version, work);
    execFileSync('tar', ['-xzf', tarball, '-C', work, `package/${binary}`], { stdio: 'inherit' });
    mkdirSync(destDir, { recursive: true });
    cpSync(join(work, 'package', binary), join(destDir, binary));
    chmodSync(join(destDir, binary), 0o755);
    writeFileSync(stamp, version);
    console.log(`staged ${pkg}@${version} -> agent-bin/${arch}/${runtime.kind}/${binary}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { all: { type: 'boolean' } } });
  const archs: string[] = [process.arch];
  if (values.all) {
    const cross = CROSS_ARCH[process.platform];
    if (!cross) throw new Error(`no cross arch configured for ${process.platform}`);
    archs.push(cross);
  }
  for (const runtime of RUNTIMES) {
    // eslint-disable-next-line no-await-in-loop -- staged one at a time so tar's inherited stdio stays readable
    for (const arch of archs) await stage(runtime, arch);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
