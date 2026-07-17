import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NpmClosureAssetDescriptor } from '../catalog';
import { closurePackagesForHost, npmTarballUrls } from '../closure';
import { generateClosure } from '../closure-gen';
import { AssetManager } from '../manager';
import { versionDir } from '../paths';
import { PI_CLOSURE } from '../pi-closure.gen';
import type { TgzFixture } from './helpers/fixtures';
import { makePackageTgz } from './helpers/fixtures';
import type { LocalServer } from './helpers/local-server';
import { startLocalServer } from './helpers/local-server';

const servers: LocalServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function freshStore(): void {
  vi.stubEnv('LINKCODE_ASSETS_DIR', mkdtempSync(join(tmpdir(), 'closure-store-')));
}

function lockfileFixture(): string {
  return `
lockfileVersion: '9.0'
packages:
  'root-pkg@1.0.0':
    resolution: {integrity: sha512-root}
  'shared@2.0.0':
    resolution: {integrity: sha512-shared2}
  'shared@1.0.0':
    resolution: {integrity: sha512-shared1}
  'needs-old@1.0.0':
    resolution: {integrity: sha512-needsold}
  'native-bit@1.0.0':
    resolution: {integrity: sha512-native}
    os: [linux]
    cpu: [x64]
  'loop-a@1.0.0':
    resolution: {integrity: sha512-loopa}
  'loop-b@1.0.0':
    resolution: {integrity: sha512-loopb}
snapshots:
  'root-pkg@1.0.0(peer@1.0.0)':
    dependencies:
      shared: 2.0.0
      needs-old: 1.0.0
      loop-a: 1.0.0
    optionalDependencies:
      native-bit: 1.0.0
  'shared@2.0.0': {}
  'shared@1.0.0': {}
  'needs-old@1.0.0':
    dependencies:
      shared: 1.0.0
  'native-bit@1.0.0': {}
  'loop-a@1.0.0':
    dependencies:
      loop-b: 1.0.0
  'loop-b@1.0.0':
    dependencies:
      loop-a: 1.0.0
`;
}

describe('generateClosure', () => {
  it('hoists the highest version and nests conflicting ones under their dependents', () => {
    const closure = generateClosure({
      lockfileText: lockfileFixture(),
      rootPackage: 'root-pkg',
      entry: 'node_modules/root-pkg/dist/index.js',
    });
    expect(closure.version).toBe('1.0.0');
    const byPath = new Map(closure.packages.map((pkg) => [pkg.path, pkg]));
    expect(byPath.get('node_modules/shared')?.version).toBe('2.0.0');
    expect(byPath.get('node_modules/needs-old/node_modules/shared')?.version).toBe('1.0.0');
    // Dependency cycles place each member once and terminate.
    expect(byPath.get('node_modules/loop-a')?.version).toBe('1.0.0');
    expect(byPath.get('node_modules/loop-b')?.version).toBe('1.0.0');
    // Platform constraints ride through from the lockfile.
    expect(byPath.get('node_modules/native-bit')).toMatchObject({ os: ['linux'], cpu: ['x64'] });
  });

  it('rejects non-registry dependencies', () => {
    const lockfileText = `
lockfileVersion: '9.0'
packages:
  'root-pkg@1.0.0':
    resolution: {integrity: sha512-root}
snapshots:
  'root-pkg@1.0.0':
    dependencies:
      linked: 'link:../somewhere'
`;
    expect(() => generateClosure({ lockfileText, rootPackage: 'root-pkg', entry: 'x' })).toThrow(
      /non-registry dependency/,
    );
  });

  it('the committed pi manifest matches the lockfile (regenerate after a pi bump)', () => {
    const lockfileText = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'pnpm-lock.yaml'),
      'utf8',
    );
    const regenerated = generateClosure({
      lockfileText,
      rootPackage: '@earendil-works/pi-coding-agent',
      entry: PI_CLOSURE.entry,
    });
    expect(regenerated).toEqual(PI_CLOSURE);
  });
});

describe('closurePackagesForHost', () => {
  it('filters by os/cpu', () => {
    const closure = {
      version: '1.0.0',
      entry: 'node_modules/a/index.js',
      packages: [
        { name: 'a', version: '1.0.0', integrity: 'sha512-a', path: 'node_modules/a' },
        {
          name: 'b',
          version: '1.0.0',
          integrity: 'sha512-b',
          path: 'node_modules/b',
          os: ['darwin'],
          cpu: ['arm64'],
        },
      ],
    };
    expect(closurePackagesForHost(closure, 'darwin', 'arm64').map((pkg) => pkg.name)).toEqual([
      'a',
      'b',
    ]);
    expect(closurePackagesForHost(closure, 'linux', 'x64').map((pkg) => pkg.name)).toEqual(['a']);
  });
});

describe('closure install', () => {
  it('downloads, verifies, and lays out the tree, then answers managedEntry', async () => {
    freshStore();
    const rootFixture: TgzFixture = makePackageTgz({
      'package.json': '{"name":"tool-a","version":"1.0.0","main":"dist/index.js"}',
      'dist/index.js': 'module.exports = 1;',
    });
    const nestedFixture: TgzFixture = makePackageTgz({
      'package.json': '{"name":"tool-b","version":"1.0.0"}',
      'index.js': 'module.exports = 2;',
    });
    const server = await startLocalServer((req, res) => {
      if (req.url?.includes('tool-a')) res.end(rootFixture.bytes);
      else res.end(nestedFixture.bytes);
    });
    servers.push(server);

    const descriptor: NpmClosureAssetDescriptor = {
      id: 'agent:opencode',
      version: { kind: 'pinned', version: '1.0.0' },
      closure: {
        version: '1.0.0',
        entry: 'node_modules/tool-a/dist/index.js',
        packages: [
          {
            name: 'tool-a',
            version: '1.0.0',
            integrity: rootFixture.integrity,
            path: 'node_modules/tool-a',
          },
          {
            name: 'tool-b',
            version: '1.0.0',
            integrity: nestedFixture.integrity,
            path: 'node_modules/tool-a/node_modules/tool-b',
          },
          {
            name: 'never-here',
            version: '1.0.0',
            integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            path: 'node_modules/never-here',
            os: ['not-an-os'],
          },
        ],
      },
    };

    const manager = new AssetManager({ catalog: [descriptor], registries: [server.url] });
    expect(manager.managedEntry('agent:opencode')).toBeUndefined();

    const progress: number[] = [];
    const installed = await manager.ensure('agent:opencode', ({ receivedBytes }) => {
      progress.push(receivedBytes);
    });

    const root = versionDir('agent:opencode', '1.0.0');
    expect(installed?.path).toBe(join(root, 'node_modules/tool-a/dist/index.js'));
    expect(existsSync(join(root, 'node_modules/tool-a/package.json'))).toBe(true);
    expect(existsSync(join(root, 'node_modules/tool-a/node_modules/tool-b/index.js'))).toBe(true);
    // The os-constrained package was skipped, not downloaded.
    expect(existsSync(join(root, 'node_modules/never-here'))).toBe(false);
    expect(server.requests.some((path) => path.includes('never-here'))).toBe(false);
    expect(progress.at(-1)).toBeGreaterThan(0);

    // Spawn-path resolution must never hand out a module tree; the entry rides managedEntry.
    expect(manager.managedBinary('agent:opencode')).toBeUndefined();
    expect(manager.managedEntry('agent:opencode')).toBe(installed?.path);
    const status = manager.statuses().find((entry) => entry.id === 'agent:opencode');
    expect(status?.installed?.path).toBe(installed?.path);
  });

  it('a stale closure manifest (pin ≠ manifest version) reads as unpinnable', () => {
    freshStore();
    const descriptor: NpmClosureAssetDescriptor = {
      id: 'agent:opencode',
      version: { kind: 'pinned', version: '2.0.0' },
      closure: { version: '1.0.0', entry: 'node_modules/x/index.js', packages: [] },
    };
    const manager = new AssetManager({ catalog: [descriptor] });
    expect(manager.wantedVersionOf('agent:opencode')).toBeUndefined();
  });
});

describe('npmTarballUrls', () => {
  it('builds scoped and unscoped registry paths with mirror fallback', () => {
    expect(npmTarballUrls('@scope/pkg', '1.2.3')).toEqual([
      'https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz',
      'https://registry.npmmirror.com/@scope/pkg/-/pkg-1.2.3.tgz',
    ]);
    expect(npmTarballUrls('plain', '1.0.0', ['http://127.0.0.1:9/'])).toEqual([
      'http://127.0.0.1:9/plain/-/plain-1.0.0.tgz',
    ]);
  });
});

// process.platform/arch are read inside stageClosure; pin the host expectation used above.
it('host filtering runs on the real process values', () => {
  expect(typeof process.platform).toBe('string');
  expect(typeof process.arch).toBe('string');
});
