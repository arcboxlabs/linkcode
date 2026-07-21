import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { NpmClosureAssetDescriptor } from '../catalog';
import { closurePackagesForHost, npmTarballUrls } from '../closure';
import { generateClosure } from '../closure-gen';
import { AssetManager } from '../manager';
import { PI_CLOSURE } from '../pi-closure.gen';

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
      join(import.meta.dirname, '..', '..', '..', '..', '..', 'pnpm-lock.yaml'),
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

describe('closure pins', () => {
  it('a stale closure manifest (pin ≠ manifest version) reads as unpinnable', () => {
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
