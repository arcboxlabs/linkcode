import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NpmClosureAssetDescriptor } from '../../src/catalog';
import { AssetManager } from '../../src/manager';
import { versionDir } from '../../src/paths';
import type { TgzFixture } from '../support/fixtures';
import { makePackageTgz } from '../support/fixtures';
import type { LocalServer } from '../support/local-server';
import { startLocalServer } from '../support/local-server';

const servers: LocalServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function freshStore(): void {
  vi.stubEnv('LINKCODE_ASSETS_DIR', mkdtempSync(join(tmpdir(), 'closure-store-')));
}

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
});
