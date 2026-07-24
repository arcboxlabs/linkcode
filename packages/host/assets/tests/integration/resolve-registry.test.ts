import { managedAgentAssetId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { AssetDescriptor } from '../../src/catalog';
import { resolveArtifact } from '../../src/resolve';
import { startLocalServer } from '../support/local-server';

describe('resolveArtifact registry integration', () => {
  it('resolves npm sources through the registry, applying the version key', async () => {
    const server = await startLocalServer((_req, res) => {
      res.end(
        JSON.stringify({
          dist: { tarball: 'https://example.test/codex.tgz', integrity: 'sha512-abc' },
        }),
      );
    });
    try {
      const descriptor: AssetDescriptor = {
        id: managedAgentAssetId('codex'),
        binaryBase: 'codex',
        version: { kind: 'pinned', version: '0.140.0' },
        artifacts: {
          'darwin-arm64': {
            kind: 'npm',
            packageName: '@openai/codex',
            versionKey: (version) => `${version}-darwin-arm64`,
            member: 'package/vendor/aarch64-apple-darwin/bin/codex',
            format: 'tgz',
          },
        },
      };
      const artifact = await resolveArtifact(descriptor, '0.140.0', {
        platform: 'darwin-arm64',
        registries: [server.url],
      });
      expect(server.requests).toEqual(['/@openai/codex/0.140.0-darwin-arm64']);
      expect(artifact).toEqual({
        urls: ['https://example.test/codex.tgz'],
        integrity: 'sha512-abc',
        format: 'tgz',
        member: 'package/vendor/aarch64-apple-darwin/bin/codex',
      });
    } finally {
      await server.close();
    }
  });
});
