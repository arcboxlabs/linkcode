import { describe, expect, it } from 'vitest';
import type { AssetDescriptor } from '../catalog';
import { CATALOG } from '../catalog';
import { UnsupportedPlatformError } from '../errors';
import { resolveArtifact } from '../resolve';
import { startLocalServer } from './helpers/local-server';

describe('resolveArtifact', () => {
  it('passes baked artifacts through untouched', async () => {
    const artifact = await resolveArtifact(CATALOG['tool:tectonic'], '0.16.9', {
      platform: 'darwin-arm64',
    });
    expect(artifact.urls).toHaveLength(1);
    expect(artifact.urls[0]).toContain('aarch64-apple-darwin');
    expect(artifact.format).toBe('tgz');
    expect(artifact.member).toBe('tectonic');
    expect(artifact.size).toBeGreaterThan(0);
  });

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
        id: 'agent:codex',
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

  it('rejects platforms the asset does not describe', async () => {
    await expect(
      resolveArtifact(CATALOG['tool:tectonic'], '0.16.9', { platform: 'win32-arm64' }),
    ).rejects.toThrow(UnsupportedPlatformError);
  });
});
